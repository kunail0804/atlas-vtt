import { DEVICE_LOGIN_MS, PENDING_LOGINS_PER_SOURCE, PENDING_LOGINS_TOTAL, SESSION_IDLE_MS, SESSION_TOUCH_MS } from './config.ts';
import type { Account, Context } from './context.ts';
import { randomToken, sha256, userCode } from './crypto.ts';
import { failure, json, page, readJson } from './http.ts';

/** A name someone chose, shown as plain text in a Discord message: its Markdown marks are escaped. */
const markdownSafe = (text: string): string => text.replace(/[\\*_`~|>#\[\]()-]/g, (mark) => `\\${mark}`);

interface DeviceLogin {
  readonly code_hash: string;
  readonly user_code: string;
  readonly discord_id: string | null;
  readonly expires_at: number;
}

/**
 * The launcher signs in like the Atlas plugin does: it asks for a code, opens the browser on the
 * login link, and polls. Discord knows no flow for programs without a browser of their own, so the
 * browser goes through Discord's usual authorization-code flow, tied to the launcher's code by `state`.
 */
/** The visitor's address as Cloudflare saw it: the key of the login rate limit. */
export const clientKey = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'unknown';

const TOO_FAST = (): Response => failure(429, 'rate', 'Trop de tentatives de connexion. Attends une minute.');

export async function startDeviceLogin(context: Context, request: Request): Promise<Response> {
  if (!(await context.allow('login', clientKey(request)))) return TOO_FAST();
  const now = context.now();
  await context.db.prepare('DELETE FROM device_logins WHERE expires_at < ?').bind(now).run();
  // Cloudflare's rate limit above is approximate; these counts are exact, and bound what this route can write.
  const source = await sha256(`login-source:${clientKey(request)}`);
  const pending = await context.db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN source = ? THEN 1 ELSE 0 END) AS mine FROM device_logins')
    .bind(source).first<{ total: number; mine: number | null }>();
  if ((pending?.mine ?? 0) >= PENDING_LOGINS_PER_SOURCE || (pending?.total ?? 0) >= PENDING_LOGINS_TOTAL) return TOO_FAST();
  const deviceCode = randomToken();
  const code = userCode();
  await context.db.prepare('INSERT INTO device_logins (code_hash, user_code, expires_at, source) VALUES (?, ?, ?, ?)')
    .bind(await sha256(deviceCode), code, now + DEVICE_LOGIN_MS, source).run();
  return json(200, { device_code: deviceCode, user_code: code, login_url: `${context.publicOrigin}/login?code=${code}`, interval: 2, expires_in: DEVICE_LOGIN_MS / 1000 });
}

async function liveLogin(context: Context, code: string): Promise<DeviceLogin | null> {
  return context.db.prepare('SELECT * FROM device_logins WHERE user_code = ? AND expires_at >= ? AND discord_id IS NULL')
    .bind(code, context.now()).first<DeviceLogin>();
}

/**
 * The login link the launcher opened. It never goes on to Discord by itself: it shows the code the
 * launcher shows, so a GM handed someone else's link (to sign them into the sender's launcher) sees
 * a code that is not on their screen.
 */
export async function openLogin(context: Context, url: URL): Promise<Response> {
  const code = url.searchParams.get('code') ?? '';
  const login = await liveLogin(context, code);
  if (login === null) return page(400, 'Lien expiré', 'Ce lien de connexion a expiré. Relance la connexion depuis le lanceur Atlas.');
  return page(200, `Code ${login.user_code}`,
    `Le lanceur Atlas sur ton ordinateur affiche ce même code ? Continue seulement si c'est le cas et si tu viens de lancer la connexion toi-même. Sinon, ferme cette page : quelqu'un essaie de se connecter avec ton compte.`,
    { label: 'Continuer avec Discord', href: `${context.publicOrigin}/login/discord?code=${encodeURIComponent(login.user_code)}` });
}

/** The GM confirmed the code: on to Discord, with a `state` that names this login. */
export async function goToDiscord(context: Context, request: Request, url: URL): Promise<Response> {
  if (!(await context.allow('login', clientKey(request)))) return TOO_FAST();
  const login = await liveLogin(context, url.searchParams.get('code') ?? '');
  if (login === null) return page(400, 'Lien expiré', 'Ce lien de connexion a expiré. Relance la connexion depuis le lanceur Atlas.');
  const state = randomToken();
  await context.db.prepare('UPDATE device_logins SET state = ? WHERE code_hash = ?').bind(state, login.code_hash).run();
  return Response.redirect(context.discord.authorizeUrl(state), 302);
}

/** Discord sends the browser back here. The account is made on the first login, pending unless it is the administrator's. */
export async function finishLogin(context: Context, request: Request, url: URL): Promise<Response> {
  if (!(await context.allow('login', clientKey(request)))) return TOO_FAST();
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const login = await context.db.prepare('SELECT * FROM device_logins WHERE state = ? AND expires_at >= ?').bind(state, context.now()).first<DeviceLogin>();
  if (login === null || code === null) return page(400, 'Connexion interrompue', 'Relance la connexion depuis le lanceur Atlas.');
  let user;
  try {
    user = await context.discord.user(code);
  } catch {
    return page(502, 'Discord n\'a pas répondu', 'Réessaie dans un moment depuis le lanceur Atlas.');
  }
  const now = context.now();
  const known = await context.db.prepare('SELECT * FROM accounts WHERE discord_id = ?').bind(user.id).first<Account>();
  if (known === null) {
    const admin = user.id === context.adminId;
    await context.db.prepare('INSERT INTO accounts (discord_id, handle, name, status, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, user.handle, user.name, admin ? 'approved' : 'pending', now, admin ? now : null).run();
    if (!admin) await context.discord.notify(`Nouvelle demande de compte Atlas : **${markdownSafe(user.name)}** (${markdownSafe(user.handle)}). Pour l'accepter : atlas admin approve ${markdownSafe(user.handle)}`);
  } else {
    await context.db.prepare('UPDATE accounts SET handle = ?, name = ? WHERE discord_id = ?').bind(user.handle, user.name, user.id).run();
  }
  await context.db.prepare('UPDATE device_logins SET discord_id = ?, state = NULL WHERE code_hash = ?').bind(user.id, login.code_hash).run();
  return page(200, 'Connecté', 'Tu peux fermer cet onglet et revenir au lanceur Atlas.');
}

/** The launcher's poll: the session once the browser came back from Discord. */
export async function pollDeviceLogin(context: Context, request: Request): Promise<Response> {
  const body = await readJson(request);
  const deviceCode = typeof body?.device_code === 'string' ? body.device_code : '';
  const hash = await sha256(deviceCode);
  const login = await context.db.prepare('SELECT * FROM device_logins WHERE code_hash = ?').bind(hash).first<DeviceLogin>();
  if (login === null || login.expires_at < context.now()) return failure(400, 'expired', 'La connexion a expiré. Recommence.');
  if (login.discord_id === null) return failure(400, 'pending', 'En attente de la connexion Discord dans le navigateur.');
  const token = randomToken();
  const now = context.now();
  await context.db.prepare('INSERT INTO sessions (token_hash, discord_id, created_at, last_used_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), login.discord_id, now, now).run();
  await context.db.prepare('DELETE FROM device_logins WHERE code_hash = ?').bind(hash).run();
  return json(200, { session_token: token });
}

/** The account behind the request's session, or null. A session unused for 30 days is gone. */
export async function sessionAccount(context: Context, request: Request): Promise<{ account: Account; tokenHash: string } | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const tokenHash = await sha256(header.slice('Bearer '.length));
  const session = await context.db.prepare('SELECT discord_id, last_used_at FROM sessions WHERE token_hash = ?').bind(tokenHash).first<{ discord_id: string; last_used_at: number }>();
  if (session === null) return null;
  const now = context.now();
  if (now - session.last_used_at > SESSION_IDLE_MS) {
    await context.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  if (now - session.last_used_at > SESSION_TOUCH_MS) {
    await context.db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  }
  const account = await context.db.prepare('SELECT * FROM accounts WHERE discord_id = ?').bind(session.discord_id).first<Account>();
  return account === null ? null : { account, tokenHash };
}

export async function logout(context: Context, tokenHash: string): Promise<Response> {
  await context.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  return json(200, {});
}

export function me(context: Context, account: Account): Response {
  return json(200, { handle: account.handle, name: account.name, status: account.status, admin: account.discord_id === context.adminId });
}

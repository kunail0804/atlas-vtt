import { CAMPAIGN_NAME, MAX_CAMPAIGNS_PER_ACCOUNT } from './config.ts';
import type { Account, Context } from './context.ts';
import { isUniqueViolation } from './db.ts';
import { failure, json, readJson } from './http.ts';

interface CampaignRow {
  readonly name: string;
  readonly discord_id: string;
  readonly tunnel_id: string | null;
  readonly dns_record_id: string | null;
  readonly created_at: number;
}

const hostOf = (context: Context, name: string): string => `${name}-vtt.${context.campaignDomain}`;
const originOf = (context: Context, name: string): string => `https://${hostOf(context, name)}`;
/** Tunnels the service makes carry this prefix; it never touches another tunnel of the account. */
const tunnelName = (name: string): string => `atlas-campaign-${name}`;

const NOT_APPROVED = 'Ton compte attend encore la validation de l\'administrateur.';

export async function listCampaigns(context: Context, account: Account): Promise<Response> {
  const { results } = await context.db.prepare('SELECT * FROM campaigns WHERE discord_id = ? AND tunnel_id IS NOT NULL ORDER BY created_at').bind(account.discord_id).all<CampaignRow>();
  return json(200, { campaigns: results.map((row) => ({ name: row.name, origin: originOf(context, row.name), createdAt: row.created_at })) });
}

/**
 * Reserves the name first (the primary key keeps one of two GMs asking at once), then makes the
 * tunnel and its address. Anything that fails is taken back, and the name is free again.
 */
export async function createCampaign(context: Context, account: Account, request: Request): Promise<Response> {
  if (account.status !== 'approved') return failure(403, 'not-approved', NOT_APPROVED);
  const body = await readJson(request);
  const name = typeof body?.name === 'string' ? body.name : '';
  if (!CAMPAIGN_NAME.test(name)) return failure(400, 'bad-name', 'Nom invalide : 1 à 30 lettres minuscules, chiffres ou tirets, sans tiret au début ni à la fin.');
  const owned = await context.db.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE discord_id = ?').bind(account.discord_id).first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_CAMPAIGNS_PER_ACCOUNT) return failure(409, 'too-many', `Tu as déjà ${MAX_CAMPAIGNS_PER_ACCOUNT} campagnes. Supprimes-en une d'abord.`);
  try {
    await context.db.prepare('INSERT INTO campaigns (name, discord_id, created_at) VALUES (?, ?, ?)').bind(name, account.discord_id, context.now()).run();
  } catch (error) {
    if (isUniqueViolation(error)) return failure(409, 'taken', `Le nom « ${name} » est déjà pris.`);
    throw error;
  }
  let tunnelId: string | null = null;
  try {
    tunnelId = await context.cloudflare.createTunnel(tunnelName(name), hostOf(context, name));
    const recordId = await context.cloudflare.createRecord(hostOf(context, name), tunnelId);
    await context.db.prepare('UPDATE campaigns SET tunnel_id = ?, dns_record_id = ? WHERE name = ?').bind(tunnelId, recordId, name).run();
  } catch (error) {
    console.error(`campaign ${name} not created: ${String(error)}`);
    if (tunnelId !== null) await context.cloudflare.deleteTunnel(tunnelId).catch((cleanup: unknown) => console.error(`tunnel ${tunnelId} left behind: ${String(cleanup)}`));
    await context.db.prepare('DELETE FROM campaigns WHERE name = ?').bind(name).run();
    return failure(502, 'cloudflare', 'Cloudflare n\'a pas pu créer la campagne. Réessaie dans un moment.');
  }
  return json(201, { name, origin: originOf(context, name) });
}

/** What the launcher needs to start a campaign: the tunnel's token and the campaign's address. */
export async function startCampaign(context: Context, account: Account, name: string): Promise<Response> {
  if (account.status !== 'approved') return failure(403, 'not-approved', NOT_APPROVED);
  const row = await context.db.prepare('SELECT * FROM campaigns WHERE name = ? AND discord_id = ?').bind(name, account.discord_id).first<CampaignRow>();
  if (row === null || row.tunnel_id === null) return failure(404, 'unknown', `Tu n'as pas de campagne « ${name} ».`);
  const token = await context.cloudflare.tunnelToken(row.tunnel_id);
  return json(200, { name, origin: originOf(context, name), tunnelToken: token });
}

export async function deleteCampaign(context: Context, account: Account, name: string): Promise<Response> {
  const row = await context.db.prepare('SELECT * FROM campaigns WHERE name = ? AND discord_id = ?').bind(name, account.discord_id).first<CampaignRow>();
  if (row === null) return failure(404, 'unknown', `Tu n'as pas de campagne « ${name} ».`);
  await removeCampaign(context, row);
  return json(200, {});
}

/**
 * Takes a campaign off Cloudflare, then out of the database: the address first, so nobody reaches
 * a campaign being removed, then the tunnel (its connections closed, which stops a running relay).
 */
export async function removeCampaign(context: Context, row: CampaignRow): Promise<void> {
  if (row.dns_record_id !== null) await context.cloudflare.deleteRecord(row.dns_record_id);
  if (row.tunnel_id !== null) await context.cloudflare.deleteTunnel(row.tunnel_id);
  await context.db.prepare('DELETE FROM campaigns WHERE name = ?').bind(row.name).run();
}

export async function campaignsOf(context: Context, discordId: string): Promise<CampaignRow[]> {
  const { results } = await context.db.prepare('SELECT * FROM campaigns WHERE discord_id = ?').bind(discordId).all<CampaignRow>();
  return results;
}

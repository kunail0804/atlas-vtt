import { readJson, sessionFile, writeJson } from './paths.ts';
import { UserError, log } from './system.ts';

/** An error the service answered, with its code (`pending`, `taken`, …) beside the GM's message. */
export class ServiceError extends UserError {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export const SERVICE = 'https://campaigns.kunlab.cc';

interface Session {
  readonly token: string;
}

export async function sessionToken(): Promise<string | null> {
  return (await readJson<Session>(sessionFile()))?.token ?? null;
}

export async function saveSession(token: string): Promise<void> {
  await writeJson(sessionFile(), { token } satisfies Session);
}

export async function forgetSession(): Promise<void> {
  await Deno.remove(sessionFile()).catch(() => undefined);
}

/**
 * One call to the service. An error the service explains comes back as its own French message; a
 * service that cannot be reached, or a session that ended, says what to do.
 */
export async function api<T>(method: string, path: string, body?: unknown, options: { session?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.session !== false) {
    const token = await sessionToken();
    if (token === null) throw new UserError('Tu n\'es pas connecté. Choisis « Se connecter » (ou : atlas login).');
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${SERVICE}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (error) {
    await log(`network ${method} ${path}: ${String(error)}`);
    throw new UserError('Impossible de joindre le service Atlas. Vérifie ta connexion internet.');
  }
  const text = await response.text();
  let value: Record<string, unknown> = {};
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // A body that is no JSON is answered below by its status.
  }
  if (response.ok) return value as T;
  await log(`service ${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
  if (response.status === 401) await forgetSession();
  const message = typeof value.message === 'string' ? value.message : `Le service a répondu ${response.status}.`;
  throw new ServiceError(message, typeof value.error === 'string' ? value.error : String(response.status));
}

export interface Me {
  readonly handle: string;
  readonly name: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'revoked';
  readonly admin: boolean;
}

export const me = (): Promise<Me> => api<Me>('GET', '/me');

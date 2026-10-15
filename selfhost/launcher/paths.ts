/** Where the launcher keeps what belongs to this GM on this machine. Nothing here is ever sent anywhere. */
export function stateDir(): string {
  if (Deno.build.os === 'windows') return `${Deno.env.get('APPDATA') ?? Deno.cwd()}\\atlas-vtt`;
  const config = Deno.env.get('XDG_CONFIG_HOME') ?? `${Deno.env.get('HOME') ?? '.'}/.config`;
  return `${config}/atlas-vtt`;
}

export function join(...parts: string[]): string {
  return parts.join(Deno.build.os === 'windows' ? '\\' : '/');
}

export const sessionFile = (): string => join(stateDir(), 'session.json');
export const campaignFile = (name: string): string => join(stateDir(), 'campaigns', `${name}.json`);
export const logFile = (): string => join(stateDir(), 'atlas.log');

export async function ensureDir(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
  await ensureDir(dir);
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

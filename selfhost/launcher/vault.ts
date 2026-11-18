import { extractPlugins } from './docker.ts';
import { isNewer } from './update.ts';
import { campaignFile, campaignsDir, join, readJson, writeJson } from './paths.ts';
import { UserError, ask, inputEnded, pickFolder } from './system.ts';

/** A plugin's code files. Its settings (`data.json`) and the vault's table (`atlas-vtt/.atlas-data`) are never touched. */
const PLUGIN_FILES = ['main.js', 'manifest.json', 'styles.css'] as const;
/** The plugins' ids, which are their folders under `.obsidian/plugins` and their names in `community-plugins.json`. */
export const ATLAS_ID = 'atlas-vtt';
export const STATBLOCKS_ID = 'obsidian-5e-statblocks';

/** What changed in the vault: a plugin's files, and whether a plugin was switched on. */
export interface VaultChanges {
  readonly atlas: boolean;
  /** The Fantasy Statblocks version put in, or null where the vault's was kept. */
  readonly statblocks: string | null;
  readonly enabled: readonly string[];
}

interface CampaignSettings {
  readonly vault: string;
}

async function isVault(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(join(path, '.obsidian'))).isDirectory;
  } catch {
    return false;
  }
}

/**
 * A path as the GM typed or pasted it: the quotes a file manager adds taken off, and a leading `~`
 * read as the home folder, as a shell would.
 */
export function typedPath(input: string, home: string | undefined): string {
  let path = input.trim();
  if (path.length >= 2 && (path[0] === '\'' || path[0] === '"') && path.endsWith(path[0])) path = path.slice(1, -1).trim();
  if (home !== undefined && (path === '~' || path.startsWith('~/') || path.startsWith('~\\'))) path = home + path.slice(1);
  return path;
}

/** Why `path` is no vault, in words that say what to choose instead; null for a vault. */
async function vaultProblem(path: string): Promise<string | null> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(path);
  } catch {
    return `Ce dossier n'existe pas : ${path}`;
  }
  if (!info.isDirectory) return `C'est un fichier, pas un dossier : ${path}`;
  if (await isVault(path)) return null;
  const inside: string[] = [];
  try {
    for await (const entry of Deno.readDir(path)) {
      if (entry.isDirectory && await isVault(join(path, entry.name))) inside.push(join(path, entry.name));
    }
  } catch {
    // An unreadable folder is answered like one without vaults.
  }
  if (inside.length > 0) return `Ce dossier contient ${inside.length === 1 ? 'un coffre' : 'des coffres'} mais n'en est pas un. Choisis le coffre lui-même : ${inside.slice(0, 5).join(', ')}`;
  return 'Ce dossier n\'est pas un coffre Obsidian : il n\'a pas de dossier .obsidian. Choisis le dossier que tu as ouvert comme coffre dans Obsidian, pas le dossier qui le contient.';
}

/** The other campaigns of this machine that use `vault`. */
async function campaignsUsing(vault: string, except: string): Promise<string[]> {
  const using: string[] = [];
  try {
    for await (const entry of Deno.readDir(campaignsDir())) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;
      const name = entry.name.slice(0, -'.json'.length);
      if (name === except) continue;
      const settings = await readJson<CampaignSettings>(join(campaignsDir(), entry.name));
      if (settings?.vault === vault) using.push(name);
    }
  } catch {
    // No campaign remembered yet.
  }
  return using;
}

/** The vault this campaign uses, or null when none is remembered (or it is no vault any more). */
export async function savedVault(name: string): Promise<string | null> {
  const saved = await readJson<CampaignSettings>(campaignFile(name));
  return saved !== null && await isVault(saved.vault) ? saved.vault : null;
}

/** Asks for the campaign's vault in a folder dialog (typed where there is none) and remembers it. */
export async function chooseVault(name: string): Promise<string> {
  console.log(`\nChoisis le coffre Obsidian de la campagne « ${name} » (le dossier qui contient .obsidian).`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const picked = (await pickFolder(`Coffre Obsidian de la campagne ${name}`)) ?? typedPath(ask('Chemin du coffre :'), Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE'));
    if (inputEnded()) break;
    if (picked === '') continue;
    const problem = await vaultProblem(picked);
    if (problem !== null) {
      console.log(problem);
      continue;
    }
    await writeJson(campaignFile(name), { vault: picked } satisfies CampaignSettings);
    const others = await campaignsUsing(picked, name);
    if (others.length > 0) console.log(`Attention : ${others.map((other) => `« ${other} »`).join(', ')} utilise${others.length > 1 ? 'nt' : ''} aussi ce coffre. Ces campagnes partagent ses scènes et son plugin.`);
    return picked;
  }
  throw new UserError('Aucun coffre choisi.');
}

/** The vault this campaign uses: remembered, or chosen once. */
export async function campaignVault(name: string): Promise<string> {
  return (await savedVault(name)) ?? chooseVault(name);
}

/** Forgets the campaign's vault on this machine (the vault itself is left as it is). */
export async function forgetVault(name: string): Promise<void> {
  await Deno.remove(campaignFile(name)).catch(() => undefined);
}

async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([Deno.readFile(a), Deno.readFile(b)]);
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
  } catch {
    return false;
  }
}

async function versionOf(folder: string): Promise<string | null> {
  const manifest = await readJson<{ version?: unknown }>(join(folder, 'manifest.json'));
  return typeof manifest?.version === 'string' ? manifest.version : null;
}

/** Copies a plugin's code files from `from` into `to` where they differ; returns whether any did. */
async function copyPlugin(from: string, to: string): Promise<boolean> {
  await Deno.mkdir(to, { recursive: true });
  let changed = false;
  for (const file of PLUGIN_FILES) {
    if (await sameFile(join(from, file), join(to, file))) continue;
    await Deno.copyFile(join(from, file), join(to, file));
    changed = true;
  }
  return changed;
}

/**
 * Switches plugins on in the vault's `community-plugins.json`, keeping every other one as it is;
 * returns the ids it added. Obsidian loads them once community plugins are on (not in restricted mode).
 */
export async function enablePlugins(vault: string, ids: readonly string[]): Promise<string[]> {
  const file = join(vault, '.obsidian', 'community-plugins.json');
  const stored = await readJson<unknown>(file);
  const enabled = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  const added = ids.filter((id) => !enabled.includes(id));
  if (added.length > 0) await writeJson(file, [...enabled, ...added]);
  return added;
}

/**
 * Puts `image`'s plugins in the vault and switches them on: Atlas whenever its files differ, and
 * Fantasy Statblocks, which Atlas reads statblocks from, where the vault has none or an older one
 * (a newer one the GM installed is kept). Neither plugin's settings are touched.
 */
export async function installPlugins(vault: string, image: string): Promise<VaultChanges> {
  const staging = await Deno.makeTempDir({ prefix: 'atlas-plugin-' });
  try {
    const atlasFrom = join(staging, 'atlas');
    const statblocksFrom = join(staging, 'statblocks');
    await Deno.mkdir(atlasFrom);
    await Deno.mkdir(statblocksFrom);
    const copied = await extractPlugins(image, { atlas: atlasFrom, statblocks: statblocksFrom });
    const plugins = join(vault, '.obsidian', 'plugins');
    const atlas = await copyPlugin(atlasFrom, join(plugins, ATLAS_ID));
    let statblocks: string | null = null;
    if (copied.has('statblocks')) {
      const bundled = await versionOf(statblocksFrom);
      const installed = await versionOf(join(plugins, STATBLOCKS_ID));
      if (bundled !== null && (installed === null || isNewer(bundled, installed)) && await copyPlugin(statblocksFrom, join(plugins, STATBLOCKS_ID))) statblocks = bundled;
    }
    const enabled = await enablePlugins(vault, copied.has('statblocks') ? [ATLAS_ID, STATBLOCKS_ID] : [ATLAS_ID]);
    return { atlas, statblocks, enabled };
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => undefined);
  }
}

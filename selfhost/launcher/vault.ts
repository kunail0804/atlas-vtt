import { extractPlugins } from './docker.ts';
import { isNewer } from './update.ts';
import { campaignFile, join, readJson, writeJson } from './paths.ts';
import { UserError, ask, pickFolder } from './system.ts';

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

/** The vault this campaign uses: remembered, or chosen once in a folder dialog (typed where there is none). */
export async function campaignVault(name: string): Promise<string> {
  const saved = await readJson<CampaignSettings>(campaignFile(name));
  if (saved !== null && await isVault(saved.vault)) return saved.vault;
  console.log(`\nChoisis le coffre Obsidian de la campagne « ${name} » (le dossier qui contient .obsidian).`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const picked = (await pickFolder(`Coffre Obsidian de la campagne ${name}`)) ?? ask('Chemin du coffre :');
    if (picked === '') continue;
    if (await isVault(picked)) {
      await writeJson(campaignFile(name), { vault: picked } satisfies CampaignSettings);
      return picked;
    }
    console.log('Ce dossier n\'est pas un coffre Obsidian : il ne contient pas de dossier .obsidian. Ouvre-le une fois dans Obsidian, puis réessaie.');
  }
  throw new UserError('Aucun coffre choisi.');
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
 * Puts the image's plugins in the vault and switches them on: Atlas whenever its files differ, and
 * Fantasy Statblocks, which Atlas reads statblocks from, where the vault has none or an older one
 * (a newer one the GM installed is kept). Neither plugin's settings are touched.
 */
export async function installPlugins(vault: string): Promise<VaultChanges> {
  const staging = await Deno.makeTempDir({ prefix: 'atlas-plugin-' });
  try {
    const atlasFrom = join(staging, 'atlas');
    const statblocksFrom = join(staging, 'statblocks');
    await Deno.mkdir(atlasFrom);
    await Deno.mkdir(statblocksFrom);
    const copied = await extractPlugins({ atlas: atlasFrom, statblocks: statblocksFrom });
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

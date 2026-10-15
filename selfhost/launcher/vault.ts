import { extractPlugin } from './docker.ts';
import { campaignFile, join, readJson, writeJson } from './paths.ts';
import { UserError, ask, pickFolder } from './system.ts';

/** The plugin's code files. Its settings (`data.json`) and the vault's table (`atlas-vtt/.atlas-data`) are never touched. */
const PLUGIN_FILES = ['main.js', 'manifest.json', 'styles.css'] as const;

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

/** Installs the image's plugin build in the vault when it differs; returns whether anything changed. */
export async function installPlugin(vault: string): Promise<boolean> {
  const staging = await Deno.makeTempDir({ prefix: 'atlas-plugin-' });
  try {
    await extractPlugin(staging);
    const target = join(vault, '.obsidian', 'plugins', 'atlas-vtt');
    await Deno.mkdir(target, { recursive: true });
    let changed = false;
    for (const file of PLUGIN_FILES) {
      if (await sameFile(join(staging, file), join(target, file))) continue;
      await Deno.copyFile(join(staging, file), join(target, file));
      changed = true;
    }
    return changed;
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => undefined);
  }
}

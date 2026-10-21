/**
 * Installing a compendium source into the vault, and removing it. Each file is compared three
 * ways, as a collection import compares them (`planImport`): what the last install wrote, what
 * the vault holds now and what the source carries. A file the GM edited is never overwritten or
 * removed; a file the GM left alone follows the source.
 */

import { planImport, resolvePlan, type PlanItemInput } from '../services/collectionBundle/importPlan';
import { installRecordPath, parseInstalledSource, type InstalledSource } from './installedSources';
import type { OpenedSource } from './sourceZip';

/** The vault as the installer uses it, so tests can run it on memory. */
export interface CompendiumVault {
  /** SHA-256 of the file's bytes, or null when there is no such file. */
  fingerprint(path: string): Promise<string | null>;
  /** Creates or replaces the file, creating its folders. */
  write(path: string, data: Uint8Array): Promise<void>;
  /** Moves the file to the trash. */
  trash(path: string): Promise<void>;
  /** Trashes the empty folders inside `root`, and `root` itself when it ends up empty. */
  trashEmptyFolders(root: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
}

export interface InstallResult {
  /** The source installed, and its book's name. */
  id: string;
  name: string;
  /** Files written for the first time, or again because the source changed them. */
  written: number;
  /** Files the source no longer has, moved to the trash. */
  removed: number;
  /** Files the GM changed, left as they are. */
  kept: string[];
}

export type InstallProgress = (done: number, total: number) => void;

export async function readInstalledSource(vault: CompendiumVault, id: string): Promise<InstalledSource | null> {
  const text = await vault.readText(installRecordPath(id));
  return text === null ? null : parseInstalledSource(text);
}

/** Installs the source, or updates the version the vault has. */
export async function installSource(vault: CompendiumVault, source: OpenedSource, onProgress: InstallProgress = () => {}, now: number = Date.now()): Promise<InstallResult> {
  const { files, ...manifest } = source.manifest;
  const record = await readInstalledSource(vault, manifest.id);
  const theirs = new Map(files.map((file) => [file.path, file.sha256]));
  const paths = [...new Set([...theirs.keys(), ...Object.keys(record?.files ?? {})])];

  const inputs: PlanItemInput[] = [];
  for (const path of paths) {
    const base = record?.files[path];
    const source = theirs.get(path) ?? null;
    inputs.push({
      key: path,
      kind: 'file',
      unit: path,
      theirs: source,
      // A source file is installed byte for byte, so what it carried is what the vault got.
      base: base ? { source: base.sha256, installed: base.sha256 } : null,
      mine: await vault.fingerprint(path),
      theirsInstalled: source ?? undefined,
    });
  }
  const plan = planImport(inputs);
  const actions = resolvePlan(plan, new Map());
  const kept = plan.units.filter((unit) => unit.status === 'kept' || unit.status === 'conflict').map((unit) => unit.key);

  let done = 0;
  let written = 0;
  let removed = 0;
  for (const [path, action] of actions) {
    if (action === 'write') {
      await vault.write(path, await source.read(path));
      written += 1;
    } else {
      await vault.trash(path);
      removed += 1;
    }
    done += 1;
    onProgress(done, actions.size);
  }
  if (removed > 0) await vault.trashEmptyFolders(manifest.root);

  const installed: InstalledSource = {
    manifest,
    installedAt: now,
    files: Object.fromEntries(files.map((file) => [file.path, { sha256: file.sha256 }])),
  };
  // Written last: an install that fails halfway leaves the previous record, and running it again finishes it.
  await vault.writeText(installRecordPath(manifest.id), `${JSON.stringify(installed)}\n`);
  return { id: manifest.id, name: manifest.book.name, written, removed, kept };
}

export interface RemoveResult {
  removed: number;
  /** Files the GM changed, left in the vault. */
  kept: string[];
}

/** Trashes the source's files the GM left as installed, keeps the others, and forgets the install. */
export async function removeSource(vault: CompendiumVault, record: InstalledSource): Promise<RemoveResult> {
  const kept: string[] = [];
  let removed = 0;
  for (const [path, file] of Object.entries(record.files)) {
    const mine = await vault.fingerprint(path);
    if (mine === null) continue;
    if (mine === file.sha256) {
      await vault.trash(path);
      removed += 1;
    } else {
      kept.push(path);
    }
  }
  await vault.trashEmptyFolders(record.manifest.root);
  await vault.trash(installRecordPath(record.manifest.id));
  return { removed, kept };
}

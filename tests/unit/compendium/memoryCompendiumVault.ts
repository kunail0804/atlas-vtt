import { sha256 } from '../../../src/app/utils/hashing';
import type { CompendiumVault } from '../../../src/app/compendium/sourceInstall';

/** An installer vault in memory: the files by path, and the paths trashed. */
export interface MemoryCompendiumVault extends CompendiumVault {
  files: Map<string, string>;
  trashed: string[];
}

export function memoryCompendiumVault(seed: Record<string, string> = {}): MemoryCompendiumVault {
  const files = new Map(Object.entries(seed));
  const trashed: string[] = [];
  return {
    files,
    trashed,
    fingerprint: async (path) => {
      const text = files.get(path);
      return text === undefined ? null : sha256(new TextEncoder().encode(text));
    },
    write: async (path, data) => { files.set(path, new TextDecoder().decode(data)); },
    trash: async (path) => {
      if (files.delete(path)) trashed.push(path);
    },
    trashEmptyFolders: async () => {},
    readText: async (path) => files.get(path) ?? null,
    writeText: async (path, text) => { files.set(path, text); },
  };
}

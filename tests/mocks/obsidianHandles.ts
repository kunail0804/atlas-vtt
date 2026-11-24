import { TFile, TFolder } from 'obsidian';

/**
 * File and folder handles at a path. Under Vitest `obsidian` is the mock (`tests/mocks/obsidian.ts`), whose classes take
 * the path; Obsidian's own declarations, which the type check reads, give their constructors no argument.
 */
export function fileHandle(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

export function folderHandle(path: string): TFolder {
  return new (TFolder as unknown as new (path: string) => TFolder)(path);
}

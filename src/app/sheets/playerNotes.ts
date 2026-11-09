import { TFile, type App } from 'obsidian';
import { ENTRY_KIND_KEY, isEntryKind } from '../compendium/sourceFormat';
import { MAX_PLAYER_NOTES, PLAYER_NOTES_KEY } from '../online/protocol/characterNotes.ts';

/** The notes a character note links for its player, as written: `[[Note]]`, `[[Folder/Note|alias]]` or a plain path. */
export function playerNoteLinks(frontmatter: Readonly<Record<string, unknown>> | null | undefined): string[] {
  const links = frontmatter?.[PLAYER_NOTES_KEY];
  return Array.isArray(links) ? links.filter((link): link is string => typeof link === 'string' && link.trim() !== '').slice(0, MAX_PLAYER_NOTES) : [];
}

/** Sets the notes linked for the character's player, as links Obsidian keeps up to date. */
export function setPlayerNotes(app: App, file: TFile, links: readonly string[]): Promise<void> {
  return app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    const kept = [...new Set(links)].slice(0, MAX_PLAYER_NOTES);
    if (kept.length === 0) delete frontmatter[PLAYER_NOTES_KEY];
    else frontmatter[PLAYER_NOTES_KEY] = kept;
  });
}

/** A link to `target` as written from `from`, the way Obsidian writes it. */
export function noteLink(app: App, target: TFile, from: string): string {
  return app.fileManager.generateMarkdownLink(target, from);
}

/** The note a player-notes link names, from the character's note. */
export function linkedNote(app: App, link: string, from: string): TFile | null {
  const inner = /^\[\[([^\]|#]+)/.exec(link.trim())?.[1] ?? /^\[[^\]]*\]\(([^)]+)\)$/.exec(link.trim())?.[1] ?? link.trim();
  const file = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(inner), from) ?? app.vault.getAbstractFileByPath(inner);
  return file instanceof TFile && file.extension === 'md' ? file : null;
}

/**
 * The notes a character links for its player, from its note `from`: the compendium entries among
 * them (a class, a spell), which the player reads as compendium pages, and the other notes, read as
 * documents.
 */
export function playerNoteFiles(app: App, links: readonly string[], from: string): { entries: TFile[]; documents: TFile[] } {
  const entries: TFile[] = [];
  const documents: TFile[] = [];
  for (const link of links) {
    const file = linkedNote(app, link, from);
    if (file === null) continue;
    const kind: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[ENTRY_KIND_KEY];
    (isEntryKind(kind) ? entries : documents).push(file);
  }
  return { entries, documents };
}

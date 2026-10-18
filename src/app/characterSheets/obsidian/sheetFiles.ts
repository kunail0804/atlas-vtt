import { normalizePath, TFile, type App } from 'obsidian';
import { frontmatterOfText } from '../../statblocks/notes/statblockSource';
import { applySheetEdit, readNoteSheet, sheetFrontmatter, type NoteSheet, type SheetEdit } from '../sheetNote.ts';
import { MAX_PLAYER_NOTES, PLAYER_NOTES_KEY, type SheetSystem } from '../sheetSystem.ts';

/** The note at a vault path, when it is Markdown. */
export function sheetFile(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  return file instanceof TFile && file.extension === 'md' ? file : null;
}

/** The sheet a note holds as its file is now (not as the metadata cache last read it: a write may be in flight); null for none. */
export async function readSheetFile(app: App, file: TFile): Promise<NoteSheet | null> {
  return readNoteSheet(frontmatterOfText(await app.vault.read(file)));
}

/** Whether the metadata cache already reads a note as a character sheet: for menus, which cannot wait. */
export function isSheetNote(app: App, path: string | undefined): boolean {
  if (path === undefined || path.trim() === '') return false;
  const file = sheetFile(app, path);
  return file !== null && readNoteSheet(app.metadataCache.getFileCache(file)?.frontmatter) !== null;
}

/** Writes a sheet's values into its note's frontmatter, leaving every other key of it as it is. */
export async function writeValues(app: App, file: TFile, system: SheetSystem, values: NoteSheet['values']): Promise<void> {
  const keys = sheetFrontmatter(system, values);
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(keys)) frontmatter[key] = value;
  });
}

/** One write after another per note: an edit is applied to what the one before it wrote. */
const queues = new Map<string, Promise<unknown>>();
function queued<T>(path: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(path) ?? Promise.resolve()).catch(() => undefined).then(run);
  queues.set(path, next);
  void next.finally(() => {
    if (queues.get(path) === next) queues.delete(path);
  }).catch(() => undefined);
  return next;
}

/** Applies an edit to a note's sheet by its system's rules and writes it; the sheet after it, or null where it was refused. */
export function editSheetFile(app: App, file: TFile, edit: SheetEdit): Promise<NoteSheet | null> {
  return queued(file.path, async () => {
    const sheet = await readSheetFile(app, file);
    if (sheet === null) return null;
    const values = applySheetEdit(sheet.system, sheet.values, edit);
    if (values === null) return null;
    await writeValues(app, file, sheet.system, values);
    return { ...sheet, values };
  });
}

/** Sets the notes linked for the character's player, as links Obsidian keeps up to date. */
export function setPlayerNotes(app: App, file: TFile, links: readonly string[]): Promise<void> {
  return queued(file.path, () => app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    const kept = [...new Set(links)].slice(0, MAX_PLAYER_NOTES);
    if (kept.length === 0) delete frontmatter[PLAYER_NOTES_KEY];
    else frontmatter[PLAYER_NOTES_KEY] = kept;
  }));
}

/** A link to `target` as written from `from`, the way Obsidian writes it. */
export function noteLink(app: App, target: TFile, from: string): string {
  return app.fileManager.generateMarkdownLink(target, from);
}

/** The note a player-notes link names, from the sheet's note. */
export function linkedNote(app: App, link: string, from: string): TFile | null {
  const inner = /^\[\[([^\]|#]+)/.exec(link.trim())?.[1] ?? /^\[[^\]]*\]\(([^)]+)\)$/.exec(link.trim())?.[1] ?? link.trim();
  const file = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(inner), from) ?? app.vault.getAbstractFileByPath(inner);
  return file instanceof TFile && file.extension === 'md' ? file : null;
}

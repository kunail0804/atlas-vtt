import type { App, EventRef, Plugin, TAbstractFile } from 'obsidian';
import { TablePlayers } from '../campaigns/players/TablePlayers';
import { ensureFolder } from '../plugin/vaultFolders';
import { ATLAS_VTT_DIR } from '../services/assetPaths';
import {
  NO_SHARES, dropPath, migrateLegacyShares, movePath, parseShares, serializeShares, setShares,
  type NamedPlayer, type PageShares as Shares, type ShareAccess, type SharesFile,
} from './shares';

/** Where the vault keeps the compendium pages shared with the players of the table, beside the campaigns. */
export const SHARES_PATH = `${ATLAS_VTT_DIR}/players.json`;

/**
 * The compendium pages shared with the players of the table, one per app. Read once from
 * `atlas-vtt/players.json`, then kept in memory and written after every change; a change of the file
 * from elsewhere (another device's sync) is read again. Notes renamed or deleted take their shares
 * along. A file of format 1 is carried over to the players of the table (`migrateLegacyShares`) once
 * they are read, and written back in the current format.
 */
export class PageShares {
  private static readonly instances = new WeakMap<App, PageShares>();
  private held: Shares = NO_SHARES;
  private loaded: Promise<void> | null = null;
  /** The text last written here, so the file's change it causes is not read back as another device's. */
  private written: string | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  static forApp(app: App): PageShares {
    let shares = PageShares.instances.get(app);
    if (!shares) {
      shares = new PageShares(app);
      PageShares.instances.set(app, shares);
    }
    return shares;
  }

  private constructor(private readonly app: App) {}

  /** Reads the file once; later calls wait for the same read. */
  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  /** The shares as they stand; none until `load` is done. */
  current(): Shares {
    return this.held;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async share(paths: readonly string[], changes: Readonly<Record<string, ShareAccess | null>>): Promise<void> {
    await this.load();
    this.change(setShares(this.held, paths, changes));
  }

  /** Follows the vault: a renamed note keeps its shares, a deleted one loses them, another device's changes are read. */
  follow(plugin: Plugin): void {
    const { vault } = this.app;
    const refs: EventRef[] = [
      vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file.path === SHARES_PATH) return void this.reread();
        void this.load().then(() => this.change(movePath(this.held, oldPath, file.path)));
      }),
      vault.on('delete', (file: TAbstractFile) => {
        void this.load().then(() => this.change(dropPath(this.held, file.path)));
      }),
      vault.on('modify', (file: TAbstractFile) => {
        if (file.path === SHARES_PATH) void this.reread();
      }),
    ];
    plugin.register(() => { for (const ref of refs) vault.offref(ref); });
  }

  private async read(): Promise<void> {
    const text = await this.readFile();
    await this.take(parseShares(text));
  }

  /** The file changed: read again unless the change is the one written here. */
  private async reread(): Promise<void> {
    await this.writing;
    const text = await this.readFile();
    if (text === null || text === this.written) return;
    await this.take(parseShares(text));
  }

  private async readFile(): Promise<string | null> {
    const file = this.app.vault.getFileByPath(SHARES_PATH);
    return file === null ? null : this.app.vault.read(file);
  }

  /** Takes what a file holds; a file of format 1 is carried over to the table's players and written. */
  private async take(file: SharesFile): Promise<void> {
    if (file.legacy === null) {
      this.held = file.shares;
      this.notify();
      return;
    }
    const players = await this.tablePlayers();
    // Without the table's players nothing can be carried over: the file stays as it is for later.
    if (players === null) return;
    const { shares, dropped } = migrateLegacyShares(file.legacy, players);
    if (dropped > 0) console.warn(`[PageShares] ${dropped} compendium share(s) matched no single player of the table by name and were dropped.`);
    this.change(shares, true);
  }

  private async tablePlayers(): Promise<readonly NamedPlayer[] | null> {
    const players = TablePlayers.forApp(this.app);
    if (players === undefined) return null;
    await players.whenReady();
    return players.roster().players;
  }

  private change(next: Shares, force = false): void {
    if (next === this.held && !force) return;
    this.held = next;
    this.notify();
    const text = serializeShares(next);
    this.writing = this.writing.then(() => this.write(text)).catch((error: unknown) => {
      console.error('[PageShares] Saving the shares failed:', error);
    });
  }

  private async write(text: string): Promise<void> {
    this.written = text;
    const existing = this.app.vault.getFileByPath(SHARES_PATH);
    if (existing !== null) {
      await this.app.vault.process(existing, () => text);
      return;
    }
    await ensureFolder(this.app, ATLAS_VTT_DIR);
    await this.app.vault.create(SHARES_PATH, text);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Loads the shares and follows the vault for them; Atlas unloading stops it. */
export function registerPageShares(plugin: Plugin): PageShares {
  const shares = PageShares.forApp(plugin.app);
  shares.follow(plugin);
  plugin.app.workspace.onLayoutReady(() => void shares.load());
  return shares;
}

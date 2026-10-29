import type { App, EventRef, Plugin, TAbstractFile } from 'obsidian';
import { ensureFolder } from '../plugin/vaultFolders';
import { ATLAS_VTT_DIR } from '../services/assetPaths';
import { randomHex } from '../utils/randomHex';
import { sha256 } from '../utils/hashing';
import {
  EMPTY_ROSTER, addPlayer, dropPath, identifyDevice, mergePlayers, movePath, parseRoster, removePlayer, renamePlayer,
  serializeRoster, setShares, type Roster, type ShareAccess,
} from './roster';

/** Where the vault keeps its players and what is shared with them, beside the campaigns. */
export const ROSTER_PATH = `${ATLAS_VTT_DIR}/players.json`;
/** A device key as the player's page makes it: 32 random bytes in base64url. */
export const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/;

const newPlayerId = (): string => `p${randomHex(8)}`;

/**
 * The vault's players and their shares, one per app. Read once from `atlas-vtt/players.json`, then
 * kept in memory and written after every change; a change of the file from elsewhere (another
 * device's sync) is read again. Notes renamed or deleted take their shares along.
 */
export class PlayerRoster {
  private static readonly instances = new WeakMap<App, PlayerRoster>();
  private roster: Roster = EMPTY_ROSTER;
  private loaded: Promise<void> | null = null;
  /** The text last written here, so the file's change it causes is not read back as another device's. */
  private written: string | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  static forApp(app: App): PlayerRoster {
    let roster = PlayerRoster.instances.get(app);
    if (!roster) {
      roster = new PlayerRoster(app);
      PlayerRoster.instances.set(app, roster);
    }
    return roster;
  }

  private constructor(private readonly app: App) {}

  /** Reads the file once; later calls wait for the same read. */
  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  /** The roster as it stands; empty until `load` is done. */
  current(): Roster {
    return this.roster;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The player a device key belongs to, by its SHA-256 only; a device Atlas has not seen is a new
   * player of the name they gave, or the player the GM made under that name. Null for a key that
   * is no device key.
   */
  async identify(key: string, name: string): Promise<string | null> {
    if (!DEVICE_KEY.test(key)) return null;
    await this.load();
    const device = await sha256(new TextEncoder().encode(key));
    const { roster, id } = identifyDevice(this.roster, device, name, Date.now(), newPlayerId);
    this.change(roster);
    return id;
  }

  async add(name: string): Promise<string> {
    await this.load();
    const { roster, id } = addPlayer(this.roster, name, Date.now(), newPlayerId);
    this.change(roster);
    return id;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.load();
    this.change(renamePlayer(this.roster, id, name));
  }

  async remove(id: string): Promise<void> {
    await this.load();
    this.change(removePlayer(this.roster, id));
  }

  async merge(from: string, into: string): Promise<void> {
    await this.load();
    this.change(mergePlayers(this.roster, from, into));
  }

  async share(paths: readonly string[], changes: Readonly<Record<string, ShareAccess | null>>): Promise<void> {
    await this.load();
    this.change(setShares(this.roster, paths, changes));
  }

  /** Follows the vault: a renamed note keeps its shares, a deleted one loses them, another device's changes are read. */
  follow(plugin: Plugin): void {
    const { vault } = this.app;
    const refs: EventRef[] = [
      vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file.path === ROSTER_PATH) return void this.reread();
        void this.load().then(() => this.change(movePath(this.roster, oldPath, file.path)));
      }),
      vault.on('delete', (file: TAbstractFile) => {
        void this.load().then(() => this.change(dropPath(this.roster, file.path)));
      }),
      vault.on('modify', (file: TAbstractFile) => {
        if (file.path === ROSTER_PATH) void this.reread();
      }),
    ];
    plugin.register(() => { for (const ref of refs) vault.offref(ref); });
  }

  private async read(): Promise<void> {
    const file = this.app.vault.getFileByPath(ROSTER_PATH);
    const text = file === null ? null : await this.app.vault.read(file);
    this.roster = parseRoster(text);
    this.notify();
  }

  /** The file changed: read again unless the change is the one written here. */
  private async reread(): Promise<void> {
    await this.writing;
    const file = this.app.vault.getFileByPath(ROSTER_PATH);
    if (file === null) return;
    const text = await this.app.vault.read(file);
    if (text === this.written) return;
    this.roster = parseRoster(text);
    this.notify();
  }

  private change(next: Roster): void {
    if (next === this.roster) return;
    this.roster = next;
    this.notify();
    const text = serializeRoster(next);
    this.writing = this.writing.then(() => this.write(text)).catch((error: unknown) => {
      console.error('[PlayerRoster] Saving the players failed:', error);
    });
  }

  private async write(text: string): Promise<void> {
    this.written = text;
    const existing = this.app.vault.getFileByPath(ROSTER_PATH);
    if (existing !== null) {
      await this.app.vault.process(existing, () => text);
      return;
    }
    await ensureFolder(this.app, ATLAS_VTT_DIR);
    await this.app.vault.create(ROSTER_PATH, text);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Loads the vault's players and follows the vault for their shares; Atlas unloading stops it. */
export function registerPlayerRoster(plugin: Plugin): PlayerRoster {
  const roster = PlayerRoster.forApp(plugin.app);
  roster.follow(plugin);
  plugin.app.workspace.onLayoutReady(() => void roster.load());
  return roster;
}

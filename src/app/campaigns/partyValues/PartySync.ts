import type { App } from 'obsidian';
import { characterOf, libraryTokenOf, type PlacedTokenSource } from '../../characters/playerCharacters';
import type { TokenAsset } from '../../services/AssetService';
import type { ViewAtlasStore } from '../../storeFactory';
import { runUntracked } from '../../stores/history';
import { partyValuesOf } from './charactersFile';
import { changesBetween, withChanges, type PartyChangeMap } from './partyChanges';
import { partyKey, type PartyValue, type PartyValues } from './partyKeys';
import type { PartyContext } from './partyReconcile';
import { PartyReconciler } from './PartyReconciler';
import type { TableCharacters } from './TableCharacters';

/** How long values wait after the last change before they are written to the table's characters file. */
export const PARTY_WRITE_MS = 500;

export interface PartySyncDeps {
  /** The table's characters file: the values whatever world is played, and without one. */
  characters: TableCharacters;
  /** The library's tokens, read from memory. */
  tokens: () => readonly TokenAsset[];
  /** Settles once the campaigns and the table's characters file were read; nothing is kept before. */
  ready: Promise<void>;
}

interface ViewLink {
  store: ViewAtlasStore;
  reconciler: PartyReconciler;
  unsubscribe: () => void;
}

/**
 * The values of the player characters (the table's `characters.json`), shared by every open view
 * whatever world is played, and while none is: which world is played, or whether it changes or
 * goes, never changes them. One per app. It mirrors the values into every view store, by character
 * and resource (`partyKey`, `partyValues`, as Atlas's own write), where each store's
 * `PartyReconciler` keeps the characters' tokens one with them; a store whose values change
 * otherwise (an edit, an undo) has them written to the file, once its changes have rested
 * `PARTY_WRITE_MS`, and mirrored to the other stores. Changes another device makes to the file
 * arrive through the vault's events. Off while the characters file is of a later format or the
 * files are not read yet: tokens keep values of their own then.
 */
export class PartySync {
  private static readonly instances = new WeakMap<App, PartySync>();

  /** The app's sync once the plugin opened it; undefined before. */
  static forApp(app: App): PartySync | undefined {
    return PartySync.instances.get(app);
  }

  static register(app: App, sync: PartySync): void {
    PartySync.instances.set(app, sync);
  }

  static release(app: App): void {
    PartySync.instances.get(app)?.destroy();
    PartySync.instances.delete(app);
  }

  private readonly views = new Map<string, ViewLink>();
  private readonly listeners = new Set<() => void>();
  private readonly stops: (() => void)[] = [];
  private readonly characterIds = new Map<string, string | null>();
  private readonly pending: PartyChangeMap = new Map();
  private loaded = false;
  private destroyed = false;
  /** Whether the values are kept now, and those values as this device knows them. */
  private keeping = false;
  private values: PartyValues = {};
  private timer: number | null = null;

  constructor(private readonly deps: PartySyncDeps) {
    this.stops.push(deps.characters.onChange(() => this.update()));
    void deps.ready.then(() => {
      this.loaded = true;
      this.update();
    }, (error: unknown) => console.error('[Atlas] Reading the table\'s characters failed:', error));
  }

  /** Keeps the store's player characters' values with the party's from now on. */
  registerStore(viewId: string, store: ViewAtlasStore): void {
    this.unregisterStore(viewId);
    const reconciler = new PartyReconciler(store);
    const unsubscribe = store.subscribe((state) => state.partyValues, (values) => this.storeChanged(viewId, values));
    this.views.set(viewId, { store, reconciler, unsubscribe });
    if (this.keeping) {
      this.mirrorInto(store, this.values);
      reconciler.setContext(this.context());
    }
  }

  unregisterStore(viewId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    view.unsubscribe();
    view.reconciler.destroy();
    this.views.delete(viewId);
  }

  /** Which library tokens are player characters may have changed: every view looks at its tokens again. */
  charactersChanged(): void {
    this.characterIds.clear();
    if (!this.keeping) return;
    for (const { reconciler } of this.views.values()) reconciler.settle();
  }

  /** Calls `listener` whenever the kept values may have changed (an edit, the file); answers how to stop. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Whether the values are kept now: the files are read and the characters file can be changed. */
  isKeeping(): boolean {
    return this.keeping;
  }

  /** The value kept of a character's resource, or undefined. */
  value(characterId: string, key: string): PartyValue | undefined {
    const values = this.keeping ? this.values : this.fileValues();
    return values[partyKey(characterId, key)];
  }

  /** The player character a token was placed from (`characterOf`: one of its forms names it), by its library token id, remembered until the library changes; null for a token of no player character. */
  characterOf(token: PlacedTokenSource): string | null {
    const key = `${token.assetId ?? ''}\u0000${token.imagePath}`;
    let id = this.characterIds.get(key);
    if (id === undefined) {
      const tokens = this.deps.tokens();
      const record = libraryTokenOf(token, tokens);
      id = record ? characterOf(record, tokens)?.id ?? null : null;
      this.characterIds.set(key, id);
    }
    return id;
  }

  /**
   * Sets a value kept of a character, as Atlas's own write: no undo step. Every open scene that
   * holds the character shows it. False while the values are not kept (`isKeeping`).
   */
  setValue(characterId: string, key: string, value: PartyValue): boolean {
    if (!this.keeping) return false;
    this.take(new Map([[partyKey(characterId, key), value]]), null);
    return true;
  }

  /** Writes what waits for the file now; settles once it is on disk. */
  flush(): Promise<void> {
    this.writePending();
    return this.deps.characters.flush();
  }

  destroy(): void {
    void this.flush();
    this.destroyed = true;
    this.listeners.clear();
    for (const stop of this.stops.splice(0)) stop();
    for (const viewId of [...this.views.keys()]) this.unregisterStore(viewId);
    this.keeping = false;
  }

  /** Whether the values should be kept now: once read, while the characters file can be changed. */
  private shouldKeep(): boolean {
    return this.loaded && !this.destroyed && this.deps.characters.isWritable();
  }

  private update(): void {
    const keep = this.shouldKeep();
    if (keep !== this.keeping) {
      if (keep) this.start();
      else this.stop();
    } else if (keep) {
      this.followFile();
    }
  }

  private start(): void {
    this.keeping = true;
    this.values = this.fileValues();
    const context = this.context();
    for (const { store, reconciler } of this.views.values()) {
      this.mirrorInto(store, this.values);
      reconciler.setContext(context);
    }
    this.changed();
  }

  private stop(): void {
    if (!this.keeping) return;
    this.keeping = false;
    this.values = {};
    for (const { reconciler } of this.views.values()) reconciler.setContext(null);
    this.writePending();
    this.changed();
  }

  /** Hands what waits to the table's characters file now. */
  private writePending(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const changes = new Map(this.pending);
    this.pending.clear();
    this.write(changes);
  }

  /** The file changed (here or on another device): its values reach the views, except where this device has changes waiting. */
  private followFile(): void {
    const changes = changesBetween(this.values, this.fileValues());
    for (const key of this.pending.keys()) changes.delete(key);
    if (changes.size === 0) return;
    this.values = withChanges(this.values, changes);
    for (const { store } of this.views.values()) this.mirrorChanges(store, changes);
    this.changed();
  }

  /** A store's values changed by anything but this sync: they are the party's now. */
  private storeChanged(viewId: string, next: PartyValues): void {
    if (!this.keeping) return;
    const changes = changesBetween(this.values, next);
    if (changes.size > 0) this.take(changes, viewId);
  }

  /** Takes changes as the party's: written to the file soon and shown in every view but `from`. */
  private take(changes: PartyChangeMap, from: string | null): void {
    this.values = withChanges(this.values, changes);
    for (const [key, value] of changes) this.pending.set(key, value);
    this.schedule();
    for (const [viewId, { store }] of this.views) if (viewId !== from) this.mirrorChanges(store, changes);
    this.changed();
  }

  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), PARTY_WRITE_MS);
  }

  /** Writes changes into the table's characters file, creating it when the vault has none. */
  private write(changes: PartyChangeMap): void {
    this.deps.characters.write(changes);
  }

  /** The file's values, keyed as the stores hold them. */
  private fileValues(): PartyValues {
    const stored = this.deps.characters.stored();
    return stored ? partyValuesOf(stored) : {};
  }

  private mirrorInto(store: ViewAtlasStore, values: PartyValues): void {
    if (store.getState().partyValues !== values) runUntracked(store, () => store.setState({ partyValues: values }));
  }

  private mirrorChanges(store: ViewAtlasStore, changes: PartyChangeMap): void {
    this.mirrorInto(store, withChanges(store.getState().partyValues, changes));
  }

  private context(): PartyContext {
    return { characterOf: (token) => this.characterOf(token) };
  }
}

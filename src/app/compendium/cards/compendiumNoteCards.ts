/**
 * The card beside every compendium note: a Markdown view whose note names a kind of entry
 * (`atlas-compendium: spell`) shows that entry as a statblock card, read-only, beside the note or
 * above it in a narrow view. A monster shows its statblock; every other entry its properties, then
 * the note's text, as the compendium tab draws it. Where Atlas' statblock editor shows the statblock already (a native
 * statblock while the experimental switch is on), the card stays away.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MarkdownView, TFile, type App, type EventRef, type Plugin } from 'obsidian';
import { experimentalFeatureOn } from '../../experimental/experimentalFeatures';
import { SettingsService } from '../../services/SettingsService';
import { cachedFrontmatter, frontmatterSource } from '../../statblocks/notes/statblockSource';
import { measureNoteRoom, watchNoteRoom } from '../../statblocks/editor/note-panel/noteRoom';
import { STACK_BELOW, loadPanelPrefs, panelWidth, savePanelPrefs } from '../../statblocks/editor/note-panel/panelPrefs';
import { observeResize } from '../../utils/observeResize';
import { noteName } from '../../utils/pathUtils';
import { ENTRY_KIND_KEY, isEntryKind } from '../sourceFormat';
import { NoteCardRoot, type NoteCardShown } from './NoteCardRoot';

/** On the view's container while its card shows: the content becomes a row. */
export const CARD_NOTE_CLASS = 'atlas-compendium-note';
/** On the view's container while the view is too narrow for two columns: the card stands above the note. */
export const CARD_STACKED_CLASS = 'atlas-compendium-note--stacked';

/** What a note's card shows, from its properties as the metadata cache reads them; null for no card. */
export function noteCardOf(app: App, file: TFile): NoteCardShown | null {
  if (file.extension !== 'md') return null;
  const frontmatter = cachedFrontmatter(app, file);
  const kind = frontmatter?.[ENTRY_KIND_KEY];
  if (frontmatter === undefined || !isEntryKind(kind)) return null;
  if (frontmatterSource(frontmatter)?.kind === 'atlas') {
    // The statblock editor shows this statblock beside the note already.
    return experimentalFeatureOn(app, 'statblockEditor') ? null : { kind: 'statblock' };
  }
  return { kind: 'card', group: kind, name: noteName(file.path) };
}

/** The card of one Markdown view: one element appended to the view's content. */
class NoteCard {
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  private stacked = false;
  private dragWidth: number | null = null;
  private readonly teardown: Array<() => void> = [];

  constructor(readonly view: MarkdownView, private file: TFile, private shown: NoteCardShown) {}

  show(file: TFile, shown: NoteCardShown): void {
    this.file = file;
    this.shown = shown;
    this.update();
  }

  update(): void {
    this.ensureHost();
    const { containerEl } = this.view;
    containerEl.toggleClass(CARD_NOTE_CLASS, true);
    containerEl.toggleClass(CARD_STACKED_CLASS, this.stacked);
    this.applyWidth();
    this.render();
  }

  detach(): void {
    const { host, root } = this;
    this.view.containerEl.removeClass(CARD_NOTE_CLASS, CARD_STACKED_CLASS);
    if (!host) return;
    for (const stop of this.teardown.splice(0)) stop();
    this.host = null;
    this.root = null;
    host.remove();
    queueMicrotask(() => root?.unmount());
  }

  private ensureHost(): void {
    if (this.host) return;
    const { contentEl } = this.view;
    // The classes of the statblock beside a note: the card gets its width, edge and scroller.
    const host = contentEl.createDiv({ cls: ['atlas-vtt-plugin', 'atlas-sb-note-panel', 'atlas-compendium-note-card'] });
    this.host = host;
    this.root = createRoot(host);
    const measure = (): void => {
      const stacked = contentEl.clientWidth > 0 && contentEl.clientWidth < STACK_BELOW;
      if (stacked !== this.stacked) {
        this.stacked = stacked;
        this.update();
      } else if (this.applyWidth()) {
        this.render();
      }
    };
    const stopObserving = observeResize([contentEl], measure);
    const stopWatching = watchNoteRoom(this.view, measure);
    this.teardown.push(stopObserving, stopWatching);
    measure();
  }

  private width(): number {
    const prefs = loadPanelPrefs(this.view.app);
    return panelWidth(this.dragWidth === null ? prefs : { width: this.dragWidth }, measureNoteRoom(this.view));
  }

  private applyWidth(): boolean {
    const { host } = this;
    if (!host) return false;
    const width = `${this.width()}px`;
    if (host.style.getPropertyValue('--atlas-sb-panel-width') === width) return false;
    host.style.setProperty('--atlas-sb-panel-width', width);
    return true;
  }

  private render(): void {
    if (!this.root) return;
    const { app } = this.view;
    this.root.render(React.createElement(NoteCardRoot, {
      app,
      file: this.file,
      shown: this.shown,
      width: this.width(),
      stacked: this.stacked,
      availableWidth: () => this.view.contentEl.clientWidth,
      onResize: (width, done) => {
        // The width the statblock beside a note takes: one choice for both.
        if (done) {
          this.dragWidth = null;
          savePanelPrefs(app, { width });
        } else {
          this.dragWidth = width;
        }
        this.applyWidth();
      },
      onCancelResize: () => {
        this.dragWidth = null;
        this.applyWidth();
      },
      onResetWidth: () => {
        savePanelPrefs(app, { width: null });
        this.applyWidth();
        this.render();
      },
    }));
  }
}

/** One manager per app: decorates every Markdown view of a compendium entry, in every window. */
export class CompendiumNoteCards {
  private readonly cards = new Map<MarkdownView, NoteCard>();
  private readonly stops: Array<() => void> = [];

  constructor(private readonly app: App) {}

  start(): void {
    const { workspace, metadataCache } = this.app;
    const refresh = (): void => this.refresh();
    const refs: EventRef[] = [
      workspace.on('layout-change', refresh),
      workspace.on('active-leaf-change', refresh),
      workspace.on('file-open', refresh),
    ];
    // A note that gains or loses its kind, or a statblock its template.
    const metadataRef = metadataCache.on('changed', refresh);
    const stopSettings = SettingsService.forApp(this.app)?.onChange(refresh);
    this.stops.push(() => {
      for (const ref of refs) workspace.offref(ref);
      metadataCache.offref(metadataRef);
      stopSettings?.();
    });
    workspace.onLayoutReady(refresh);
  }

  release(): void {
    for (const stop of this.stops.splice(0)) stop();
    for (const card of this.cards.values()) card.detach();
    this.cards.clear();
  }

  refresh(): void {
    const seen = new Set<MarkdownView>();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const { view } = leaf;
      if (view instanceof MarkdownView) {
        seen.add(view);
        this.evaluate(view);
      }
    });
    for (const [view, card] of this.cards) {
      if (seen.has(view)) continue;
      card.detach();
      this.cards.delete(view);
    }
  }

  private evaluate(view: MarkdownView): void {
    const card = this.cards.get(view);
    const { file } = view;
    const shown = file instanceof TFile ? noteCardOf(this.app, file) : null;
    if (file === null || shown === null) {
      card?.detach();
      this.cards.delete(view);
      return;
    }
    if (card) {
      card.show(file, shown);
      return;
    }
    const created = new NoteCard(view, file, shown);
    this.cards.set(view, created);
    created.update();
  }
}

/** Starts the app's manager; Atlas unloading takes every card off. */
export function registerCompendiumNoteCards(plugin: Plugin): CompendiumNoteCards {
  const cards = new CompendiumNoteCards(plugin.app);
  cards.start();
  plugin.register(() => cards.release());
  return cards;
}

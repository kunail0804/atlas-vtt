import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import { SettingsService } from '../../../src/app/services/SettingsService';
import { CompendiumNoteCards } from '../../../src/app/compendium/cards/compendiumNoteCards';
import { TemplateLibrary } from '../../../src/app/statblocks/library/TemplateLibrary';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

vi.mock('../../../src/app/services/AssetService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/app/services/AssetService')>();
  const assets = {
    getCollections: async () => [{ id: 'campaign', name: 'Campaign' }],
    getAssets: async () => [],
    getDefaultCollectionId: () => 'campaign',
    loadedTokenAssets: () => [],
    getCollectionSettings: () => ({ conditions: [] }),
  };
  return { ...actual, AssetService: { getInstance: () => assets } };
});

const SPELL = 'Compendium/D&D 5e 2014/SRD 5.1/Spells/Fireball.md';
const CONDITION = 'Compendium/D&D 5e 2014/SRD 5.1/Conditions/Blinded.md';
const GOBLIN = 'Compendium/D&D 5e 2014/SRD 5.1/Monsters/Goblin.md';
const PLAIN = 'Notes/Marsh.md';

const FRONTMATTER: Record<string, Record<string, unknown>> = {
  [SPELL]: { 'atlas-compendium': 'spell', name: 'Fireball', level: 3, school: 'Evocation' },
  [CONDITION]: { 'atlas-compendium': 'condition', name: 'Blinded' },
  [GOBLIN]: { 'atlas-compendium': 'monster', statblock: true, 'atlas-template': 'builtin:5e-2014-monster', name: 'Goblin', ac: 15, ac_class: 'leather armor, shield', hp: 7 },
  [PLAIN]: { tags: 'marsh' },
};
const FILES = {
  [SPELL]: '---\natlas-compendium: spell\nname: Fireball\nlevel: 3\nschool: Evocation\n---\nA bright streak flashes.\n',
  [CONDITION]: '---\natlas-compendium: condition\nname: Blinded\n---\nYou cannot see.\n',
  [GOBLIN]: '---\natlas-compendium: monster\nstatblock: true\natlas-template: builtin:5e-2014-monster\nname: Goblin\nac: 15\nac_class: leather armor, shield\nhp: 7\n---\n',
  [PLAIN]: '---\ntags: marsh\n---\nMud.\n',
};

type Listener = (...args: unknown[]) => unknown;

class NoteView extends MarkdownView {
  constructor(leaf: WorkspaceLeaf, path: string) {
    super(leaf);
    this.containerEl.classList.add('workspace-leaf-content');
    this.contentEl.classList.add('view-content');
    this.contentEl.createDiv({ cls: 'markdown-source-view' });
    this.containerEl.appendChild(this.contentEl);
    document.body.appendChild(this.containerEl);
    this.file = new TFile(path);
  }
}

const started: Array<{ app: App; cards: CompendiumNoteCards; settings: SettingsService }> = [];

function setup({ statblockEditor = false } = {}): { cards: CompendiumNoteCards; open: (path: string) => NoteView; trigger: (name: string) => void; frontmatter: typeof FRONTMATTER } {
  const { app } = createInMemoryApp({ files: FILES });
  const settings = new SettingsService(app);
  if (statblockEditor) settings.setExperimental('statblockEditor', true);
  const listeners = new Map<string, Set<Listener>>();
  const on = (name: string, listener: Listener): { name: string; listener: Listener } => {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
    return { name, listener };
  };
  const offref = (ref: { name: string; listener: Listener }): void => void listeners.get(ref.name)?.delete(ref.listener);
  const trigger = (name: string): void => { for (const listener of listeners.get(name) ?? []) listener(); };
  const leaves: Array<{ view: unknown }> = [];
  app.workspace = { iterateAllLeaves: (callback: (leaf: unknown) => void) => { for (const leaf of [...leaves]) callback(leaf); }, on, offref, onLayoutReady: (callback: () => void) => callback() };
  const frontmatter = { ...FRONTMATTER };
  app.metadataCache = { ...app.metadataCache, on, offref, getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }) };
  const cards = new CompendiumNoteCards(app);
  started.push({ app, cards, settings });
  const open = (path: string): NoteView => {
    const leaf = { view: null as unknown, app };
    const view = new NoteView(leaf as unknown as WorkspaceLeaf, path);
    leaf.view = view;
    leaves.push(leaf);
    return view;
  };
  return { cards, open, trigger, frontmatter };
}

afterEach(async () => {
  for (const { app, cards, settings } of started.splice(0)) {
    cards.release();
    TemplateLibrary.release(app);
    await settings.saveSettingsNow();
  }
  await act(async () => { await Promise.resolve(); });
  cleanup();
  document.body.replaceChildren();
});

const cardOf = (view: NoteView): HTMLElement | null => view.contentEl.querySelector('.atlas-compendium-note-card');

describe('the card beside a compendium note', () => {
  it('shows a spell\'s properties beside its note, without the text the note shows', async () => {
    const { cards, open } = setup();
    const view = open(SPELL);
    await act(async () => { cards.start(); });
    expect(view.containerEl.classList.contains('atlas-compendium-note')).toBe(true);
    await waitFor(() => expect(cardOf(view)?.textContent).toContain('Evocation'));
    expect(cardOf(view)?.textContent).toContain('Fireball');
    expect(cardOf(view)?.textContent).not.toContain('A bright streak');
  });

  it('shows a monster\'s own statblock, with what gives its armour class', async () => {
    const { cards, open } = setup();
    const view = open(GOBLIN);
    await act(async () => { cards.start(); });
    await waitFor(() => expect(cardOf(view)?.textContent).toContain('15 (leather armor, shield)'));
  });

  it('leaves alone a plain note, an entry with nothing but its name, and a statblock the statblock editor shows', async () => {
    const { cards, open } = setup({ statblockEditor: true });
    const views = [open(PLAIN), open(CONDITION), open(GOBLIN)];
    await act(async () => { cards.start(); });
    for (const view of views) {
      expect(cardOf(view)).toBeNull();
      expect(view.containerEl.classList.contains('atlas-compendium-note')).toBe(false);
    }
  });

  it('goes once the note is no compendium entry any more', async () => {
    const { cards, open, trigger, frontmatter } = setup();
    const view = open(SPELL);
    await act(async () => { cards.start(); });
    expect(cardOf(view)).not.toBeNull();
    frontmatter[SPELL] = { name: 'Fireball' };
    await act(async () => { trigger('changed'); });
    expect(cardOf(view)).toBeNull();
    expect(view.containerEl.className).toBe('workspace-leaf-content');
  });
});

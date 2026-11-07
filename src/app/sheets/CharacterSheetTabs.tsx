import React, { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { App, TFile } from 'obsidian';
import { characterTemplateOf, EDITIONS, isCharacterTemplateId, noteFile, type CharacterTemplateId } from './characterTemplates';
import { switchEdition } from './editionSwitch';
import { playerNoteLinks } from './playerNotes';
import { SheetBook } from './SheetBook';
import { SheetCompendiumBar } from './SheetCompendiumBar';
import { gmSheetCompendium } from './sheetCompendiumHost';
import { SheetDocuments } from './SheetDocuments';
import { SHEET_TEXT } from './sheetText';

type Tab = keyof typeof SHEET_TEXT.tabs;
const TABS: readonly Tab[] = ['sheet', 'book', 'notes'];

/** The note's frontmatter as the metadata cache reads it. */
function frontmatterOf(app: App, file: TFile | null): Readonly<Record<string, unknown>> | undefined {
  return file === null ? undefined : app.metadataCache.getFileCache(file)?.frontmatter;
}

/** The note's frontmatter, again after every change of it. */
function useFrontmatter(app: App, file: TFile | null): Readonly<Record<string, unknown>> | undefined {
  const [frontmatter, setFrontmatter] = useState(() => frontmatterOf(app, file));
  useEffect(() => {
    setFrontmatter(frontmatterOf(app, file));
    const ref = app.metadataCache.on('changed', (changed) => {
      if (changed.path === file?.path) setFrontmatter(frontmatterOf(app, file));
    });
    return () => app.metadataCache.offref(ref);
  }, [app, file]);
  return frontmatter;
}

/** The rules a sheet follows: only the GM picks them. */
function EditionPicker({ app, path, edition }: { app: App; path: string; edition: CharacterTemplateId }): ReactElement {
  const change = (next: string): void => {
    if (isCharacterTemplateId(next)) switchEdition(app, path, next).catch((error: unknown) => console.error('[CharacterSheetTabs] Switching the rules failed:', error));
  };
  return (
    <label className="atlas-sheet-rules">
      <span className="atlas-sheet-label">{SHEET_TEXT.rules}</span>
      <select className="atlas-sheet-input" aria-label={SHEET_TEXT.rules} value={edition} onChange={(event) => change(event.target.value)}>
        {Object.entries(EDITIONS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}

/**
 * The statblock panel of a player character's note: its sheet (the statblock pane, with the rules and
 * the compendium above it), the book of its player and the notes linked for them. Any other note gets
 * the pane alone. The pane stays mounted behind the other tabs, so what is typed in it is kept.
 */
export function CharacterSheetTabs({ app, notePath, children }: { app: App; notePath: string; children: ReactNode }): ReactElement {
  const file = noteFile(app, notePath);
  const frontmatter = useFrontmatter(app, file);
  const edition = characterTemplateOf(frontmatter);
  const [tab, setTab] = useState<Tab>('sheet');
  const compendium = useMemo(() => (file === null ? null : gmSheetCompendium(app, file)), [app, file]);
  if (file === null || edition === null || compendium === null) return <>{children}</>;
  return (
    <div className="atlas-sheet-panel">
      <div className="atlas-sheet-tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" className="atlas-sheet-tab" aria-selected={tab === id} onClick={() => setTab(id)}>{SHEET_TEXT.tabs[id]}</button>
        ))}
      </div>
      <div hidden={tab !== 'sheet'}>
        <div className="atlas-sheet-compendium">
          <EditionPicker app={app} path={file.path} edition={edition} />
        </div>
        <SheetCompendiumBar compendium={compendium} />
        {children}
      </div>
      {tab === 'book' && <div className="atlas-sheet-box"><SheetBook app={app} file={file} /></div>}
      {tab === 'notes' && <div className="atlas-sheet-box"><SheetDocuments app={app} file={file} links={playerNoteLinks(frontmatter)} /></div>}
    </div>
  );
}

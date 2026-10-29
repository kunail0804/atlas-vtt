import React from 'react';
import type { App, TFile } from 'obsidian';
import { PanelHostContent } from '../../statblocks/editor/panel-frame/PanelHost';
import { LinkedStatblock } from '../../statblocks/render/LinkedStatblock';
import type { EntryGroup } from '../compendiumEntries';
import { EntryCardView } from './EntryCardView';
import './compendium-note-card.scss';

/** What a compendium note's card shows: its own statblock, or a card of its properties. */
export type NoteCardShown = { readonly kind: 'statblock' } | { readonly kind: 'card'; readonly group: EntryGroup; readonly name: string };

export interface NoteCardRootProps {
  app: App;
  file: TFile;
  shown: NoteCardShown;
  width: number;
  stacked: boolean;
  availableWidth: () => number;
  onResize: (width: number, done: boolean) => void;
  onCancelResize: () => void;
  onResetWidth: () => void;
}

/** The card beside a compendium note: the edge that resizes it and, scrolling on its own, the card. */
export function NoteCardRoot({ app, file, shown, ...host }: NoteCardRootProps): React.JSX.Element {
  return (
    <PanelHostContent {...host}>
      {shown.kind === 'statblock'
        ? <LinkedStatblock key={file.path} app={app} path={file.path} variant="full" />
        : <EntryCardView key={file.path} app={app} file={file} group={shown.group} name={shown.name} variant="full" />}
    </PanelHostContent>
  );
}

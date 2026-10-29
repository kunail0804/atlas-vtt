import React, { useEffect, useMemo, useState } from 'react';
import type { App, TAbstractFile, TFile } from 'obsidian';
import { LinkedStatblock } from '../../statblocks/render/LinkedStatblock';
import type { SheetVariant } from '../../statblocks/render/sheetTypes';
import { t } from '../../i18n';
import type { EntryGroup } from '../compendiumEntries';
import { entryCard } from '../entryCard';

/** The note's text, read again whenever the note changes; null while it is read. */
export function useNoteText(app: App, file: TFile): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const read = (): void => {
      app.vault.cachedRead(file).then((read) => { if (current) setText(read); }, (error: unknown) => {
        console.error('[EntryCardView] Reading the note failed:', error);
        if (current) setText('');
      });
    };
    setText(null);
    read();
    const ref = app.vault.on('modify', (changed: TAbstractFile) => { if (changed.path === file.path) read(); });
    return () => {
      current = false;
      app.vault.offref(ref);
    };
  }, [app, file]);
  return text;
}

export interface EntryCardViewProps {
  app: App;
  file: TFile;
  group: EntryGroup;
  /** The name shown when the note's properties give none. */
  name: string;
  variant: SheetVariant;
  /** Leave the note's text off the card: the note shows it beside the card. */
  withoutText?: boolean | undefined;
}

/** A compendium entry but a native statblock, drawn as a statblock card of its properties and text. */
export function EntryCardView({ app, file, group, name, variant, withoutText = false }: EntryCardViewProps): React.JSX.Element | null {
  const text = useNoteText(app, file);
  // One array per card: the statblock reads its template again only when the card changes.
  const card = useMemo(() => {
    if (text === null) return null;
    const made = entryCard(group, text, name, t('compendium.browser.yes'), { withText: !withoutText });
    return { text: made.text, templates: [made.template] };
  }, [text, group, name, withoutText]);
  if (card === null) return null;
  return <LinkedStatblock app={app} path={file.path} noteText={card.text} bundleTemplates={card.templates} variant={variant} />;
}

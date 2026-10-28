import React, { useEffect, useMemo, useState } from 'react';
import { TFile, type App, type TAbstractFile } from 'obsidian';
import { BookOpen, ExternalLink, Trash2 } from 'lucide-react';
import type { CompendiumEntry } from '../../../../compendium/compendiumEntries';
import { entryCard } from '../../../../compendium/entryCard';
import { cachedFrontmatter, frontmatterSource } from '../../../../statblocks/notes/statblockSource';
import { LinkedStatblock } from '../../../../statblocks/render/LinkedStatblock';
import { Button } from '../../primitives/button';
import { t } from '../../../../i18n';

/** The note's text, read again whenever the note changes; null while it is read. */
function useNoteText(app: App, file: TFile): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const read = (): void => {
      app.vault.cachedRead(file).then((read) => { if (current) setText(read); }, (error: unknown) => {
        console.error('[CompendiumEntryPreview] Reading the note failed:', error);
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

/** Any entry but a native statblock, drawn as a statblock card of its properties and text. */
function EntryCardView({ app, entry, file }: { app: App; entry: CompendiumEntry; file: TFile }): React.JSX.Element | null {
  const text = useNoteText(app, file);
  // One array per card: the statblock reads its template again only when the card changes.
  const card = useMemo(() => {
    if (text === null) return null;
    const made = entryCard(entry.group, text, entry.name, t('compendium.browser.yes'));
    return { text: made.text, templates: [made.template] };
  }, [text, entry.group, entry.name]);
  if (card === null) return null;
  return <LinkedStatblock app={app} path={entry.path} noteText={card.text} bundleTemplates={card.templates} variant="hover" />;
}

interface CompendiumEntryPreviewProps {
  app: App;
  entry: CompendiumEntry | null;
  onOpen: (entry: CompendiumEntry) => void;
  onDelete: (entry: CompendiumEntry) => void;
}

/** The selected entry as a statblock card, with Open and Delete. A monster shows its own statblock. */
export function CompendiumEntryPreview({ app, entry, onOpen, onDelete }: CompendiumEntryPreviewProps): React.JSX.Element {
  const file = entry ? app.vault.getAbstractFileByPath(entry.path) : null;
  if (!entry || !(file instanceof TFile)) {
    return (
      <div className="atlas-compendium-preview atlas-compendium-preview--empty">
        <BookOpen aria-hidden />
        <span>{t('compendium.browser.selectEntry')}</span>
      </div>
    );
  }
  const isStatblock = frontmatterSource(cachedFrontmatter(app, file))?.kind === 'atlas';

  return (
    <div className="atlas-compendium-preview">
      {/* The card shows the entry's name; above it, where its note is and what to do with it. */}
      <div className="atlas-compendium-preview__header">
        <span className="atlas-compendium-preview__path">{entry.path}</span>
        <Button variant="ghost" size="sm" onClick={() => onOpen(entry)}>
          <ExternalLink aria-hidden />
          <span>{t('compendium.browser.open')}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(entry)}>
          <Trash2 aria-hidden />
          <span>{t('compendium.browser.delete')}</span>
        </Button>
      </div>
      <div className="atlas-compendium-preview__body">
        {/* Keyed by note, so every entry opens scrolled to its top. */}
        {isStatblock
          ? <LinkedStatblock key={entry.path} app={app} path={entry.path} variant="hover" />
          : <EntryCardView key={entry.path} app={app} entry={entry} file={file} />}
      </div>
    </div>
  );
}

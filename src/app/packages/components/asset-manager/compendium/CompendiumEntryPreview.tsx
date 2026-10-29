import React from 'react';
import { TFile, type App } from 'obsidian';
import { BookOpen, ExternalLink, Share2, Trash2 } from 'lucide-react';
import type { CompendiumEntry } from '../../../../compendium/compendiumEntries';
import { EntryCardView } from '../../../../compendium/cards/EntryCardView';
import { cachedFrontmatter, frontmatterSource } from '../../../../statblocks/notes/statblockSource';
import { LinkedStatblock } from '../../../../statblocks/render/LinkedStatblock';
import { Button } from '../../primitives/button';
import { t } from '../../../../i18n';

interface CompendiumEntryPreviewProps {
  app: App;
  entry: CompendiumEntry | null;
  /** Who the entry is shared with, as a line. */
  sharedWith: string | null;
  onShare: (entry: CompendiumEntry) => void;
  onOpen: (entry: CompendiumEntry) => void;
  onDelete: (entry: CompendiumEntry) => void;
}

/** The selected entry as a statblock card, with Open and Delete. A monster shows its own statblock. */
export function CompendiumEntryPreview({ app, entry, sharedWith, onShare, onOpen, onDelete }: CompendiumEntryPreviewProps): React.JSX.Element {
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
        <Button variant="ghost" size="sm" onClick={() => onShare(entry)}>
          <Share2 aria-hidden />
          <span>{t('compendium.share.button')}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(entry)}>
          <Trash2 aria-hidden />
          <span>{t('compendium.browser.delete')}</span>
        </Button>
      </div>
      {sharedWith !== null && <p className="atlas-compendium-preview__shared">{sharedWith}</p>}
      <div className="atlas-compendium-preview__body">
        {/* Keyed by note, so every entry opens scrolled to its top. */}
        {isStatblock
          ? <LinkedStatblock key={entry.path} app={app} path={entry.path} variant="hover" />
          : <EntryCardView key={entry.path} app={app} file={file} group={entry.group} name={entry.name} variant="hover" />}
      </div>
    </div>
  );
}

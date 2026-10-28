import React, { useEffect, useRef, useState } from 'react';
import { Component, MarkdownRenderer, TFile, type App } from 'obsidian';
import { BookOpen, ExternalLink, Trash2 } from 'lucide-react';
import type { CompendiumEntry } from '../../../../compendium/compendiumEntries';
import { cachedFrontmatter, frontmatterSource } from '../../../../statblocks/notes/statblockSource';
import { LinkedStatblock } from '../../../../statblocks/render/LinkedStatblock';
import { followLinksIn } from '../../../../statblocks/render/shared/linkEvents';
import { Button } from '../../primitives/button';
import { t } from '../../../../i18n';

/** Properties every compendium note carries for Atlas, which say nothing to the reader. */
const HIDDEN_KEYS = new Set(['name', 'statblock', 'position', 'tags', 'aliases', 'cssclasses']);

function labelOf(key: string): string {
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? t('compendium.browser.yes') : t('compendium.browser.no');
  if (Array.isArray(value)) return value.map(valueText).filter((text) => text !== '').join(', ');
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).map(([key, item]) => `${key}: ${valueText(item)}`).join(', ');
  }
  return '';
}

/** The note's properties as a Markdown list, then its text without the frontmatter. */
export function previewMarkdown(frontmatter: Readonly<Record<string, unknown>> | undefined, text: string): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (HIDDEN_KEYS.has(key) || key.startsWith('atlas-')) continue;
    const shown = valueText(value);
    if (shown !== '') lines.push(`- **${labelOf(key)}**: ${shown}`);
  }
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '').trim();
  return [lines.join('\n'), body].filter((part) => part !== '').join('\n\n');
}

function NotePreview({ app, file }: { app: App; file: TFile }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setText(null);
    app.vault.cachedRead(file).then((read) => { if (current) setText(read); }, (error: unknown) => {
      console.error('[CompendiumEntryPreview] Reading the note failed:', error);
      if (current) setText('');
    });
    return () => { current = false; };
  }, [app, file]);

  useEffect(() => {
    const el = ref.current;
    if (!el || text === null) return;
    el.replaceChildren();
    const component = new Component();
    const markdown = previewMarkdown(cachedFrontmatter(app, file), text);
    MarkdownRenderer.render(app, markdown, el, file.path, component).catch((error: unknown) => {
      console.error('[CompendiumEntryPreview] Rendering the note failed:', error);
    });
    const stopLinks = followLinksIn(el, app, file.path);
    return () => {
      stopLinks();
      component.unload();
      el.replaceChildren();
    };
  }, [app, file, text]);

  return <div ref={ref} className="atlas-compendium-preview__note markdown-rendered" />;
}

interface CompendiumEntryPreviewProps {
  app: App;
  entry: CompendiumEntry | null;
  onOpen: (entry: CompendiumEntry) => void;
  onDelete: (entry: CompendiumEntry) => void;
}

/** The selected entry: a monster's statblock, or any other note's properties and text; with Open and Delete. */
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
      <div className="atlas-compendium-preview__header">
        <h3 className="atlas-compendium-preview__title">{entry.name}</h3>
        <Button variant="ghost" size="sm" onClick={() => onOpen(entry)}>
          <ExternalLink aria-hidden />
          <span>{t('compendium.browser.open')}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(entry)}>
          <Trash2 aria-hidden />
          <span>{t('compendium.browser.delete')}</span>
        </Button>
      </div>
      <div className="atlas-compendium-preview__path">{entry.path}</div>
      <div className="atlas-compendium-preview__body">
        {/* Keyed by note, so every entry opens scrolled to its top. */}
        {isStatblock
          ? <LinkedStatblock key={entry.path} app={app} path={entry.path} variant="hover" />
          : <NotePreview key={entry.path} app={app} file={file} />}
      </div>
    </div>
  );
}

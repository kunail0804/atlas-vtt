/**
 * Keeps the fields a template works out (`TemplateField.derive`) written in every native statblock
 * note: after any change of the note, by the pane, a player, a compendium pick or a hand edit.
 */

import type { Plugin, TFile } from 'obsidian';
import { TemplateLibrary } from '../library/TemplateLibrary';
import type { StatblockTemplate } from '../model/templateTypes';
import { derivedPatches, derivesFields } from '../values/derivedValues';
import { NoteFieldWriter } from './NoteFieldWriter';
import { frontmatterSource } from './statblockSource';

/** The template of a native note whose frontmatter is this, where it works out some fields. */
function derivingTemplate(plugin: Plugin, frontmatter: Readonly<Record<string, unknown>> | undefined): StatblockTemplate | null {
  const source = frontmatterSource(frontmatter);
  if (source?.kind !== 'atlas') return null;
  const found = TemplateLibrary.forApp(plugin.app).get(source.templateId);
  return found !== null && found.status === 'ok' && derivesFields(found.template) ? found.template : null;
}

/** Writes what a note's template works out where the note holds something else; nothing otherwise. */
export function writeDerivedFields(plugin: Plugin, file: TFile): void {
  const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
  const template = derivingTemplate(plugin, frontmatter);
  if (template === null || frontmatter === undefined || derivedPatches(template, frontmatter).length === 0) return;
  // Built from the note as the write finds it, so a change made meanwhile is never undone.
  NoteFieldWriter.forApp(plugin.app).patchNow(file.path, (current) => (current === null ? [] : derivedPatches(template, current)))
    .catch((error: unknown) => console.error('[derivedFields] Writing worked-out fields failed:', error));
}

/** Follows every note change for as long as the plugin runs. */
export function registerDerivedFields(plugin: Plugin): void {
  plugin.registerEvent(plugin.app.metadataCache.on('changed', (file) => writeDerivedFields(plugin, file)));
}

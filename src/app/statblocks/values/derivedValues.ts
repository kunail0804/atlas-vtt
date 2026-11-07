/**
 * The fields a template works out from others and writes into the note (`TemplateField.derive`): a
 * character's level from its classes, its hit dice, its proficiency bonus. Pure.
 */

import { isExpressionError } from '../expressions/errors';
import { parsePatternCached } from '../expressions/patternParse';
import { renderPattern } from '../expressions/pattern';
import type { FieldKey, FieldValue, StatblockTemplate, TemplateField } from '../model/templateTypes';
import type { NotePatch } from '../notes/patchTypes';
import { toFieldValue } from './fieldValueOf';
import { readerFor, type FieldRecord } from './fieldValues';
import { parseNumberText } from './numberText';

/** Whether a template has any field it works out. */
export function derivesFields(template: StatblockTemplate): boolean {
  return template.fields.some((field) => field.derive !== undefined);
}

/** The pattern's text as the field stores it: a number field a number, where the text is one. */
function storedValue(field: TemplateField, text: string): FieldValue {
  if (field.type !== 'number') return text;
  return parseNumberText(text) ?? text;
}

/**
 * The value of every field the template works out, in field order, each read with the ones before it
 * already worked out (a proficiency bonus from the level worked out from the classes). A field whose
 * pattern gives nothing is left out: it keeps what was typed.
 */
export function derivedValues(template: StatblockTemplate, record: FieldRecord): Map<FieldKey, FieldValue> {
  const values = new Map<FieldKey, FieldValue>();
  let current: Record<string, unknown> = { ...record };
  for (const field of template.fields) {
    if (field.derive === undefined) continue;
    const ast = parsePatternCached(field.derive);
    if (isExpressionError(ast)) continue;
    const rendered = renderPattern(ast, readerFor(current, template.fields), { lookups: template.lookups });
    if (rendered.empty || rendered.text === '') continue;
    const value = storedValue(field, rendered.text);
    values.set(field.key, value);
    current = { ...current, [field.key]: value };
  }
  return values;
}

/** The patches that write each worked-out value the note does not hold yet; none where it holds them all. */
export function derivedPatches(template: StatblockTemplate, frontmatter: FieldRecord): NotePatch[] {
  const patches: NotePatch[] = [];
  for (const [key, next] of derivedValues(template, frontmatter)) {
    const base = Object.hasOwn(frontmatter, key) ? toFieldValue(frontmatter[key]) : undefined;
    if (base !== next) patches.push({ op: 'set', path: [key], base, next });
  }
  return patches;
}

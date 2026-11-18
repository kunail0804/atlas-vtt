import { describe, expect, it } from 'vitest';
import { TRANSLATIONS } from '../../src/app/i18n/languages';
import type { Message } from '../../src/app/i18n/types';
import { SHEET_TEXT } from '../../src/app/sheets/sheetText';

/** Messages about the hosted campaign (launcher, `<name>-vtt.kunlab.cc`), the one thing still called a campaign. */
const HOSTED_CAMPAIGN_KEYS = new Set(['settings.updates.howToUpdate', 'settings.updates.notice']);

/** "Campaign" in every language Atlas ships, outside `{placeholders}`. */
const CAMPAIGN_WORD = /campaign|campagne|кампани|战役/i;

function forms(message: Message): string[] {
  return typeof message === 'string' ? [message] : Object.values(message).filter((form): form is string => form !== undefined);
}

function withoutPlaceholders(text: string): string {
  return text.replace(/\{\w+\}/g, '');
}

/** Every text a nested object of strings and text functions shows, with `key` paths. */
function sheetTexts(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function') return [[path, String((value as (...args: string[]) => unknown)('x', 'x', 'x'))]];
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => sheetTexts(inner, `${path}.${key}`));
  }
  return [];
}

describe('world vocabulary (#23)', () => {
  it('calls the campaign page a world in every language', () => {
    const offenders = Object.entries(TRANSLATIONS).flatMap(([language, translation]) =>
      Object.entries(translation)
        .filter(([key]) => !HOSTED_CAMPAIGN_KEYS.has(key))
        .filter(([, message]) => message !== undefined && forms(message).some((form) => CAMPAIGN_WORD.test(withoutPlaceholders(form))))
        .map(([key]) => `${language}:${key}`),
    );
    expect(offenders).toEqual([]);
  });

  it('calls the campaign page a world on the character sheet', () => {
    const offenders = sheetTexts(SHEET_TEXT, 'SHEET_TEXT').filter(([, text]) => CAMPAIGN_WORD.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

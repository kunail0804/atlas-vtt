import type { Translations } from '.';
import { en } from './locales/en';
import { fr } from './locales/fr';
import { ru } from './locales/ru';
import { zh } from './locales/zh';

/** Languages Atlas speaks, keyed by Obsidian's language codes; a new language is registered here. */
export const TRANSLATIONS: Translations = { en, fr, ru, zh };

/**
 * Mundane equipment with the numbers a sheet computes from (armour class, damage, properties),
 * and magic items with their rarity and attunement.
 */

import { entryProperties, FOLDERS, type BuildContext } from './context.ts';
import { noteText, type Note } from './notes.ts';
import { cost, field, indexOf, isJson, list, nameOf, names, num, prose, text, type Json } from './values.ts';

export function registerEquipment(context: BuildContext): void {
  for (const item of context.data('Equipment')) context.registry.register(FOLDERS.equipment, indexOf(item), nameOf(item));
  for (const item of context.data('Magic-Items')) context.registry.register(FOLDERS.magicItems, indexOf(item), nameOf(item));
}

/** The item's categories, by name: one in 2014, several (most specific first) in 2024. */
function categories(item: Json): string[] {
  const many = names(item.equipment_categories);
  return many.length > 0 ? many : [nameOf(item.equipment_category)].filter((name) => name !== '');
}

type ItemType = 'weapon' | 'armor' | 'shield' | 'gear' | 'tool' | 'mount' | 'vehicle' | 'ammunition' | 'pack';

function itemType(item: Json, all: readonly string[]): ItemType {
  const lower = all.map((name) => name.toLowerCase());
  if (item.damage !== undefined || lower.some((name) => name.includes('weapon'))) return 'weapon';
  if (indexOf(item) === 'shield' || text(item.armor_category) === 'Shield' || lower.includes('shields')) return 'shield';
  if (item.armor_class !== undefined || lower.some((name) => name.includes('armor'))) return 'armor';
  if (lower.some((name) => name.includes('tool') || name.includes('instrument') || name.includes('gaming'))) return 'tool';
  if (lower.some((name) => name.includes('mount'))) return 'mount';
  if (lower.some((name) => name.includes('vehicle'))) return 'vehicle';
  if (lower.some((name) => name.includes('ammunition'))) return 'ammunition';
  if (lower.some((name) => name.includes('pack'))) return 'pack';
  return 'gear';
}

/** "Heavy" from 2014's `armor_category`, or from a 2024 category such as "Heavy Armor". */
function armorCategory(item: Json, all: readonly string[]): string {
  const direct = text(item.armor_category);
  if (direct !== '') return direct;
  const named = all.find((name) => / Armor$/.test(name));
  return named ? named.replace(/ Armor$/, '') : '';
}

/** "Martial Melee" from 2014's `category_range`, or from 2024's categories. */
function weaponCategory(item: Json, all: readonly string[]): string {
  const direct = text(item.category_range);
  if (direct !== '') return direct;
  return all.find((name) => /^(Simple|Martial) (Melee|Ranged) Weapons$/.test(name))?.replace(/ Weapons$/, '') ?? '';
}

function rangeText(item: Json): string {
  const normal = num(field(item.range, 'normal'));
  const long = num(field(item.range, 'long')) ?? num(field(item.throw_range, 'long'));
  if (normal === undefined) return '';
  return long === undefined ? `${normal} ft.` : `${normal}/${long} ft.`;
}

export function equipmentNotes(context: BuildContext): Note[] {
  return context.data('Equipment').map((item) => {
    const all = categories(item);
    const type = itemType(item, all);
    const armor = isJson(item.armor_class) ? item.armor_class : undefined;
    const isArmor = type === 'armor' || type === 'shield';
    const properties = {
      ...entryProperties(context, 'item'),
      name: nameOf(item),
      'item-type': type,
      categories: all,
      cost: cost(item.cost),
      weight: num(item.weight),
      'armor-category': isArmor ? armorCategory(item, all) : '',
      'armor-class': num(field(armor, 'base')),
      'dex-bonus': armor === undefined ? undefined : field(armor, 'dex_bonus') === true,
      'max-dex-bonus': num(field(armor, 'max_bonus')) || undefined,
      'strength-minimum': num(item.str_minimum) || undefined,
      'stealth-disadvantage': item.stealth_disadvantage === true ? true : undefined,
      'weapon-category': type === 'weapon' ? weaponCategory(item, all) : '',
      damage: text(field(item.damage, 'damage_dice')),
      'damage-type': nameOf(field(item.damage, 'damage_type')),
      'two-handed-damage': text(field(item.two_handed_damage, 'damage_dice')),
      range: type === 'weapon' ? rangeText(item) : '',
      properties: names(item.properties),
      mastery: nameOf(item.mastery),
    };
    const contents = list(item.contents).map((entry) => `- ${num(field(entry, 'quantity')) ?? 1} × ${nameOf(field(entry, 'item'))}`);
    const body = [prose(item), ...list(item.special).filter((line): line is string => typeof line === 'string'), contents.length === 0 ? '' : `**Contents**\n\n${contents.join('\n')}`]
      .filter((part) => part !== '').join('\n\n');
    return { path: context.registry.pathOf(FOLDERS.equipment, indexOf(item)) ?? '', text: noteText(properties, body) };
  });
}

/** 2014 writes attunement in the first line of the text: "Wondrous item, rare (requires attunement by a wizard)". */
function attunement(item: Json): string | boolean {
  if (typeof item.attunement === 'boolean') return item.attunement;
  const firstLine = Array.isArray(item.desc) ? text(item.desc[0]) : text(item.desc).split('\n')[0] ?? '';
  const match = /\(requires attunement([^)]*)\)/i.exec(firstLine);
  if (!match) return false;
  const who = (match[1] ?? '').trim();
  return who === '' ? true : `requires attunement ${who}`;
}

export function magicItemNotes(context: BuildContext): Note[] {
  return context.data('Magic-Items').map((item) => {
    const properties = {
      ...entryProperties(context, 'magic-item'),
      name: nameOf(item),
      category: nameOf(item.equipment_category),
      rarity: nameOf(item.rarity),
      attunement: attunement(item),
      variant: item.variant === true ? true : undefined,
      variants: list(item.variants).map((variant) => context.registry.link(FOLDERS.magicItems, indexOf(variant), nameOf(variant))),
    };
    return { path: context.registry.pathOf(FOLDERS.magicItems, indexOf(item)) ?? '', text: noteText(properties, prose(item)) };
  });
}

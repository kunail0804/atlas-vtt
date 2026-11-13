// SPDX-License-Identifier: AGPL-3.0-only AND CC-BY-4.0

/**
 * What the 5E character of the 2024 rules (SRD 5.2.1) works out from its classes: its hit point
 * maximum and its spell slots. Each class entry says how it casts (`caster`), which a compendium pick
 * copies from the class's `spellcasting-progression`; the slots follow the Multiclass Spellcaster table.
 */

/** How a class casts spells, as its entry on the sheet says it: in full, as a half or a third caster, or by Pact Magic. */
export const CASTER_KINDS = ['Complet', 'Demi', 'Tiers', 'Pacte'] as const;
export type CasterKind = (typeof CASTER_KINDS)[number];

/** The compendium's `spellcasting-progression` of a class, as its entry on the sheet says it. */
export const CASTER_OF_PROGRESSION: Readonly<Record<string, CasterKind>> = { full: 'Complet', half: 'Demi', third: 'Tiers', pact: 'Pacte' };

/** The name of a row of spell slots in the note: one per spell level. */
export const slotRowName = (level: number): string => `Niveau ${level}`;

/** Slots of spell levels 1 to 9 by caster level (SRD 5.2.1, Multiclass Spellcaster table; the Wizard's table alike). */
const SLOTS_BY_CASTER_LEVEL: readonly (readonly number[])[] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/**
 * The lookup table of spell slots: caster level, then every spell level's row and its maximum
 * (`Niveau 1: 4, Niveau 2: 3, Niveau 3: 0, …`), 0 where that level has none, so a row the character
 * no longer has goes. No row for caster level 0: a sheet without a caster class keeps the slots typed in it.
 */
export function spellSlotTable(): Record<string, string> {
  return Object.fromEntries(SLOTS_BY_CASTER_LEVEL.map((slots, index) => [
    String(index + 1),
    Array.from({ length: 9 }, (_, level) => `${slotRowName(level + 1)}: ${slots[level] ?? 0}`).join(', '),
  ]));
}

const is = (kind: CasterKind): string => `has(caster, "${kind}")`;
/** How many classes cast with spell slots (Pact Magic is not counted). */
const CASTING_CLASSES = `sum(classes, ${is('Complet')} + ${is('Demi')} + ${is('Tiers')})`;

/**
 * The caster level: the levels of full casters, half the levels of each half caster rounded up, and a
 * third of each third caster's rounded down, as the Multiclass Spellcaster table counts them; a single
 * third caster rounds up, as its own class table does. Warlock levels never count.
 */
export const CASTER_LEVEL = [
  `sum(classes, ${is('Complet')} * level + ${is('Demi')} * ceil(level / 2) + ${is('Tiers')} * floor(level / 3))`,
  `max(0, 1 - abs(${CASTING_CLASSES} - 1)) * sum(classes, ${is('Tiers')} * (ceil(level / 3) - floor(level / 3)))`,
].join(' + ');

/** The spell slots' pattern: the caster level's row of the `spell_slots` table. */
export const SPELL_SLOTS_PATTERN = `{=${CASTER_LEVEL}|lookup:spell_slots}`;

/**
 * The hit point maximum: the first class's hit die at its highest for the first level, the die's fixed
 * value (half its sides plus one) for every other level, and the Constitution modifier for every level.
 */
export const HIT_POINTS_PATTERN = '{=sum(classes, level * (sides(die) / 2 + 1)) + first(classes, sides(die) / 2 - 1) + level * floor((stats.2 - 10) / 2)}';

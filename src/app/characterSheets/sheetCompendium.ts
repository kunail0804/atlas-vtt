/**
 * How a character sheet reaches the compendium: the entries of a kind to pick from, what picking one
 * does, reading one, and (the GM's) making a new one. The sheet's host provides it: the GM's Atlas
 * reads the vault, the player's page asks the GM. Pure data, no Obsidian and no React.
 */

/** What a sheet picks from the compendium. A weapon and an armour are items of the compendium. */
export const PICK_KINDS = ['class', 'subclass', 'species', 'background', 'weapon', 'armor', 'spell'] as const;
export type PickKind = (typeof PICK_KINDS)[number];

export const isPickKind = (value: unknown): value is PickKind => typeof value === 'string' && (PICK_KINDS as readonly string[]).includes(value);

/** An entry offered: an id of the host's own (never a vault path on a player's page), its name, a line about it. */
export interface CompendiumChoice {
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
}

export interface SheetCompendium {
  /** The entries of a kind the character may take, from the campaign's books. */
  choices(kind: PickKind): Promise<readonly CompendiumChoice[]>;
  /** Takes an entry into the sheet, and into the book where it is a thing the character carries. */
  pick(kind: PickKind, choice: CompendiumChoice): void;
  /** Opens the entry of that name to read. */
  view(kind: PickKind, name: string): void;
  /** Makes a new entry of the kind, named `name` where one was typed; the GM's alone. */
  create?: ((kind: PickKind, name: string) => void) | undefined;
}

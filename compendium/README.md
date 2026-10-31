# Compendium sources

A compendium source is a zip of finished Obsidian notes that Atlas installs into the vault, under
`Compendium/<game system>/<book>/`. Atlas offers the two free SRDs; a GM can export a folder of their
own notes as a personal source and install it in another vault.

## What a source zip holds

- `manifest.json`: the source id (`<system id>/<book id>`), the system and book names, a version, the
  language, the folder it installs to, the licence, the attribution, and every file with its SHA-256.
  `src/app/compendium/sourceFormat.ts` defines and checks it.
- `ATTRIBUTION.md`: the licence credit, for whoever opens the zip.
- `files/`: the notes, at their vault paths. Atlas copies them byte for byte.

Each note's frontmatter starts with `atlas-compendium` (spell, monster, class, subclass, species,
background, feat, item, magic-item, condition, rule), `atlas-system` and `atlas-source`. Monster notes are
native statblocks of the built-in 5E template of their edition (`statblock: true`, `atlas-template`). The
compendium tab of the asset manager and a linked token's preview show them as statblocks. A compendium note
opened in Obsidian shows its entry as a read-only card beside it (`src/app/compendium/cards/`): a monster its
statblock, any other entry the card of its properties. While the experimental Statblock editor is on, a
monster shows the editable statblock instead. Fantasy Statblocks reads monsters only with its "Parse
Frontmatter" setting on. Both 5E monster templates show `ac_class` after the armour class: "15 (leather
armor, shield)".

`src/app/compendium/sourceFormat.ts` holds the kinds, their folders and the monster template of each
system; the build and Atlas read the same list.

## Build the SRD sources

The notes come from the JSON of [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (MIT),
which transcribes SRD 5.1 and SRD 5.2.1 (both CC BY 4.0). The build reads the English files.

The database does not transcribe the whole SRD, so the sources hold part of it. Spells, monsters,
classes, species, equipment and magic items are there. The 2014 source has one background and one
feat, and the 2024 source has no rules text beyond the weapon properties and masteries. Each
source's `Attribution.md` note says so.

1. Clone the database into a folder of its own:

   ```sh
   git clone --depth 1 https://github.com/5e-bits/5e-database.git /tmp/srd-src/5e-database
   ```

2. Build the zips:

   ```sh
   npm run compendium:build -- --database /tmp/srd-src/5e-database --out /tmp/compendium-out
   ```

   The build writes one zip per source and `catalog.json`, which lists each zip's size and SHA-256. The
   same input always gives the same bytes.

3. If the notes changed, raise `version` of that source in `compendium/builder/sources.ts` and build again.

## Publish the SRD sources

1. Upload the zips to the GitHub release `compendium-v<N>` of `kunail0804/atlas-vtt`.
2. Copy each zip's `size` and `sha256` from `catalog.json` into `src/app/compendium/officialSources.ts`,
   and set `RELEASE` to the new tag.
3. Build and ship the plugin. Atlas refuses a download whose size or SHA-256 differs from that list.

The data the last published zips came from: 5e-database commit `a6212beb4b278917c2cff41c2b04c4ef4f3e0d6f`.

## Install, update and remove

In a campaign's page, **Compendium** opens the source picker. It also opens on its own when a campaign
is created. The GM ticks a whole game system or single books; saving downloads what the vault lacks
and stores the choice in the campaign's `sources`. Sources are installed once per vault and every
campaign can use them.

Every game system a campaign uses has a **Personal** book (`<system>/personal`), which is no choice: Atlas
makes it and adds it to the campaign when the picker saves, and when the compendium tab shows a campaign that
lacks it. The GM's own entries go there, so the books Atlas publishes stay as published. A Personal book is
never removed from the tab, exported, or installed from another vault's zip. A book installed in the vault has
a remove button. **Not in this vault** lists the sources a campaign names that the vault lacks, to untick them.

An update compares each file three ways, as a collection import does (`importPlan.ts`): what the last
install wrote (the record in `atlas-vtt/compendium/`), what the vault holds and what the source
carries. A file the GM changed or deleted stays as the GM left it. Removing a source moves its untouched
files to the trash and keeps the changed ones.

## The compendium tab

The asset manager's **Compendium** tab, after the asset types, lists the entries of a campaign's books: the
campaign this device plays, else the most recently played one. **Every installed source** lists every book
of the vault. The sidebar filters by book and by kind, and the toolbar searches the names. The selected
entry shows beside the list as a statblock card: a monster's own statblock, and for any other note a card
made from its properties (in the order `src/app/compendium/entryCard.ts` lists for its kind) and its text.
The note itself is not changed. **Open the
note** opens it in a new tab and closes the manager; **Delete** moves it to the trash.

- The gear next to the campaign opens the source picker.
- **New book…** makes an empty personal source in a game system the vault has or a new one, records it as
  installed and adds it to the campaign.
- **New entry…** writes a note into a book's folder of its kind (`Monsters/`, `Spells/`…) with
  `atlas-compendium`, `atlas-system`, `atlas-source` and `name`. A monster of a system with a built-in monster
  template (`MONSTER_TEMPLATES`) is a native statblock of that template.
- The upload button beside a personal book exports it, as the folder's file menu does. The trash button
  beside a book removes it from the vault after the GM confirms, and from the campaign shown.
- **Not in this vault** lists the campaign's sources the vault lacks.
- **New entry…** offers the campaign's Personal book first.
- Ticking entries shows a bar that shares them, copies them into a book of the GM's own (where they can be
  changed), or deletes them.

## Sharing pages with players

The GM shares compendium pages with players from the compendium tab. The tick on each row selects
entries for a batch share; **Share…** in the toolbar shares the ticked entries, or the selected one, and the
preview's **Share…** shares the entry shown. For each player the GM chooses **Not shared**, **Read** or
**Read and write**, and changes or takes it back the same way. The preview says who has the entry, and a
row shared with anyone shows a mark.

A player is one person for the whole vault, in every campaign and at every table
(`src/app/players/`). The player's page keeps a key of its own in the browser and sends it after joining.
Atlas keeps only its SHA-256, in `atlas-vtt/players.json`, with the players' names and the shares. A device
never seen makes a new player of the name given. A player the GM made under **Players** with **New player…**
takes the first device that joins under that name. **Rename or merge** says that two players are the same
person, who joined from two devices: one keeps both players' devices and pages. Shares outlive a table and a
campaign. Removing a player under **Players** ends them, and so does deleting the note. A renamed or moved
note keeps its shares.

The player reads the shared pages in the **Compendium** tab of their book: a list by kind, and each page as
a card of its lines, its named entries (a monster's actions) and its text. Where the GM gave **Read and
write**, **Modifier** edits the page's simple properties and its text; the GM's Atlas writes them into the note
and every player who has the page open gets it again. The protocol is `src/app/online/protocol/compendium.ts`.
Their list is in folders by book, then by kind; the notes the GM links to their character sit there too.

## The compendium on a character sheet

A 5e sheet picks from the campaign's books (`src/app/characterSheets/sheetCompendium.ts`): the campaign
played, else the one played last, else every installed book.

- **Class**: **+ Classe** adds a class at level 1 with its hit die; a character may have several. The sheet's
  level is their levels added up, and its hit dice follow ("3d10 + 2d6"). Each class name opens its entry.
- **Subclass**, **species**, **background**: the search button picks one, the eye opens it.
- **Weapon**: **+ Du compendium** under the attacks adds an attack worked out from the character (Strength,
  Dexterity for a ranged weapon, the better for a finesse one, plus proficiency), and puts the weapon into the
  character's book, in the main hand or the off hand where free.
- **Armour**: **Armure…** sets the armour class (its base, Dexterity up to its cap, +2 on top for a shield) and
  puts it into the book, in the armour slot or the off hand.
- **Spell**: **+ Du compendium** in the Spells tab adds it to the list, with its level and how it is cast.

The GM's picker has a **+** that makes a new entry of that kind in the campaign's Personal book, named after
what was searched, and opens it. A player's picker asks the GM (`sheet-choices`, `sheet-pick`): it has no **+**.
A player who opens an entry of their sheet (`sheet-view`) reads it in their compendium tab while they sit at the
table, and goes back to the sheet from there. The spells and weapons their sheet names are in their
compendium list, to read. An item goes into the book only while online play keeps books and a token is linked
to the sheet; the GM is told otherwise.

## Personal sources

Right-click a folder `Compendium/<game system>/<book>` and choose **Export as compendium source**, or run the
command **Export a compendium book as a source**: it exports the book of the note open, else the book the GM
picks. An export refuses a Personal book, an empty folder, one of Atlas' own sources, and a folder whose id
another installed book has ("My Book" and "My-Book"). Atlas
saves the zip to the downloads folder and records the source as installed in this vault. Another
vault installs it with **Install from a file…** in the source picker. A personal source must not be
published: books outside the SRD are copyrighted.

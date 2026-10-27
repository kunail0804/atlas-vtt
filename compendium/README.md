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
native statblocks of the built-in 5E template of their edition (`statblock: true`, `atlas-template`), so
they open in Atlas and in Fantasy Statblocks.

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

An update compares each file three ways, as a collection import does (`importPlan.ts`): what the last
install wrote (the record in `atlas-vtt/compendium/`), what the vault holds and what the source
carries. A file the GM changed or deleted stays as the GM left it. Removing a source moves its untouched
files to the trash and keeps the changed ones.

## Personal sources

Right-click a folder `Compendium/<game system>/<book>` and choose **Export as compendium source**. Atlas
saves the zip to the downloads folder and records the source as installed in this vault. Another
vault installs it with **Install from a file…** in the source picker. A personal source must not be
published: books outside the SRD are copyrighted.

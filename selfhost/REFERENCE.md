# Relay reference

The relay is one Node process with two HTTP listeners. Both bind to `127.0.0.1`
(`relay/config.ts`).

| Side | Port | Reached by | Serves |
|---|---|---|---|
| GM | 8787 | The plugin, over loopback | Sign-in, `/api/me`, table creation, the GM's socket |
| Public | 8788 | Players, through the Cloudflare Tunnel | The player page, `/health`, players' sockets |

The plugin's addresses are in `src/app/online/gm/servers.ts`: `RELAY_ORIGIN` and
`ACCOUNTS_ORIGIN` name the GM side, on loopback. The public side is the `playerOrigin` the relay
answers when a table is created (`CreatedTable.playerOrigin`). A join link is
`<playerOrigin>/#<table code>` (`OnlineTable.link`).

## Routes

### GM side

| Route | File | State |
|---|---|---|
| `POST /auth/device/code` | `relay/account.ts` | Done. Answers a device code. |
| `POST /auth/device/token` | `relay/account.ts` | Done. Answers the GM's token at once. |
| `POST /auth/sign-out` | `relay/account.ts` | Done. Answers 200. |
| `GET /api/me` | `relay/account.ts` | Done. 401 without the GM's token, else the local account with `maxPlayers: MAX_PLAYERS`. |
| `GET /account` | `relay/account.ts` | Done. A page that says the sign-in worked. |
| `POST /api/feedback`, `POST /api/reports` | `relay/diagnostics.ts` | Done. Keeps the plugin's feedback and error reports in `<DATA_DIR>/feedback.jsonl` and `reports.jsonl`, up to 1 MB each. |
| `POST /api/tables` | `relay/relay.ts`, `Tables.create` | Done. Ends the previous table with `superseded`. |
| Socket `/api/tables/<code>/socket` | `relay/tables.ts`, `relay/table.ts` | Done. Takes only the GM's hello. |

The GM's token is stored in `<DATA_DIR>/host-token` (mode 600). Delete that file to sign the
plugin out. `GET /api/me` and `POST /api/tables` also answer `playerOrigin`, the campaign's public
address.

### Public side

| Route | File | State |
|---|---|---|
| `GET /health` | `relay/server.ts` | Done. Answers `ok`. |
| `GET` any other path | `relay/staticFiles.ts` | Done. Serves `player/dist`. Unknown and malformed paths get `index.html`. |
| Socket `/api/tables/<code>/socket` | `relay/tables.ts`, `relay/table.ts` | Done. Takes only players' hellos. |

A socket path whose code does not match `TABLE_CODE_PATTERN` gets HTTP 404 before the upgrade.

## Settings

`relay/main.ts` reads them from the environment. Without them the relay runs for development.

| Variable | Default | Meaning |
|---|---|---|
| `RELAY_HOST` | `127.0.0.1` | Where both listeners bind. `0.0.0.0` in the container. |
| `DATA_DIR` | `selfhost/.local` | Tables (`tables.json`) and the GM's token (`host-token`). |
| `PLAYER_ORIGIN` | `https://vtt.kunlab.cc` | The campaign's public address. |
| `IDLE_STOP_MINUTES` | unset: never stops | Minutes with no socket open before the relay exits. |

## Table rules

The protocol's types are in `src/app/online/protocol/relay.ts`. The relay never reads a game
message's `body`.

| Rule | Value | Where |
|---|---|---|
| A socket must send its `hello` within | 10 s, else `protocol` | `relay/tables.ts` |
| GM hello | GM side only, with the table's secret, else `badSecret` | `Table.attachGm` |
| Player hello | public side only; a known `key` takes its seat back without the gate | `Table.attachPlayer` |
| Table started again | a new table on the same link (`POST /api/tables` with the campaign's `code`) keeps the seats and keys of the one before, so a returning device takes its seat back by its `key` | `Tables.create` |
| Campaign players | the GM sends its campaign's players (`players`, id, name, own code) after every welcome; a hello whose `code` is a player's own takes that player's seat past the gate, from any device; a newcomer whose name is a campaign player's, without that player's key or code (a cleared browser, another device), passes the join code like any newcomer and then always waits for the GM, whatever `ask` says: the knock says `reclaim`, and an admission seats them under that player's id with a new key, so the key the seat had seats nobody any more and a page still on the seat is closed with `replaced`; a decline leaves the seat and its key as they were. Kept in memory only | `Table.attachPlayer`, `Table.seatAdmitted` |
| Wrong join code | `wrongCode`; 10 within 10 minutes pause joins for 10 minutes (`paused`) | `relay/gate.ts` |
| New join code from the GM | ends the pause and forgets wrong codes | `JoinGate.set` |
| Waiting room | at most `MAX_WAITING` (8), else `tooManyKnocks`; no answer in 5 minutes gives `noAnswer` | `relay/gate.ts` |
| Seats | at most `maxPlayers` connected at once, else `full` | `Table.seat` |
| Player frames | `send` only, at most 4 KB (`tooLarge`), 60 per second after a burst of 120 (`rateLimited`) | `Table.fromPlayer` |
| Player acks | `ack` with the count of frames marked `ack` the socket received, 400 per second after a burst of 800 (`rateLimited`); an ack past what was sent is ignored | `Table.fromPlayer`, `relay/outbox.ts` |
| GM frames | at most 320 KB (`tooLarge`) | `relay/link.ts` |
| Batches | the GM's welcome says `batch`: the GM may send a moment's messages as one `sends` frame, each routed as its own `send` would be, with its lane | `Table.fromGm` |
| Send lanes | A GM's `send` names a `lane` (`SendLane`). To a page whose hello says `acks`: `paced` (a part of a large message) and `bulk` (no sender uses it since the asset store) go only while what is on its way would take under a second to arrive, at the speed its acks show, and are marked `ack`; `paced` and lane-less frames keep the GM's order; `bulk` goes when no ordered frame waits; `live` goes at once. A page without `acks` gets everything at once | `relay/outbox.ts` |
| Keep-alive | `ping` answered `pong` at every stage | `relay/link.ts` |
| New table | ends the previous one: GM gets `superseded`, players `ended` | `Tables.create` |
| Saved | tables, gate settings and players' key hashes, on every change, in `tables.json` | `relay/tableStore.ts` |

## Tests

`npm test` starts real relays on random ports. The GM side of every test is the plugin's own
`TableConnection`, so a test fails when the relay stops answering the way the plugin expects.

## The player page

`player/src/main.ts` starts it. The table code comes from the link's hash
(`<playerOrigin>/#<table code>`).

| Part | File | What it does |
|---|---|---|
| Join screen | `ui.ts` | Name and optional six-digit code, French messages for every close code |
| Toolbar | `toolbar.tsx`, `toolSettings.ts` | The GM's toolbar, built from the plugin's own components (`ToolGroup`, the dropdown rows, `DiceTray`) and stylesheet: Move/Laser with the laser's colour and size, Pen/Icon stamp/Eraser with ink and sizes, Text with colour, size and bold, Measure line/circle/cone with Persist Measurements, and the dice tray with advantage where the dice set has it. The GM's keys (V, B, T, M, R); Escape closes a menu, else goes back to Move. The log's button in the bottom left corner, the book's in the bottom right. Settings are kept in the browser |
| Drawings and texts | `drawTools.ts` | The pen, stamp, eraser and text tool. What the player makes goes to the GM (`draw`, `place-text`, `erase`); the page shows its own copy until the GM's `annotations` hold it. The eraser rubs out only the player's own ink, and only the part under it |
| Connection | `connection.ts` | Hello, keep-alive, reconnect with backoff, key kept in `localStorage` per table, wait token |
| Inbox | `inbox.ts` | Puts `part` messages together, follows deltas with the plugin's `DeltaReader`, asks for a `resync` on a gap |
| Assets | `assets.ts` | Fetches each stored asset from the relay by its id (`/api/assets/<id>`) once the GM's `asset-progress` says it is there (else every 5 s, ten minutes at most), checks its size and SHA-256, shrinks an image larger than the side asked for; quest texts are read with the plugin's `readQuestText` |
| Asset cache | `assetCache.ts` | Keeps images and quest texts in Cache Storage between visits, checked against their SHA-256 on every read: at most 200 MB (or a tenth of the origin's quota) and 2,000 entries, least recently used out first, nothing over a quarter of the budget. The explored memory and everything else of the table's state is never kept |
| Stage | `stage.ts` | The layers in order: map, grid, tokens, annotations, fog, pins |
| Scene | `sceneView.ts` | Routes every scene message to its layer |
| Map | `mapLayer.ts` | Draws the map at its own size; serves as the grid's `MosaicCanvasView` |
| Grid | `sceneView.ts` | The plugin's `GridSystem` |
| Tokens | `tokenLayer.ts`, `tokenUI.ts` | Draws tokens with the GM's ring artwork, their bars, conditions and the downed mark; the player's own tokens show the bars `mine` carries, every resource as their owner sees it, where everyone else's list holds only the players' resources; drags the player's own (`drag`, `move`, `drag-cancel`), by mouse or touch; follows `live` and `move-refused` |
| Fog | `fogLayer.ts` | The plugin's `FogCanvasCompositor`, solid for players |
| Dynamic lighting | `litScene.ts`, `playerLighting.ts`, `litMarks.ts` | The plugin's `LightingRenderer` in the players' view; door badges, sensed outlines, explored memory. The map stays covered until sight is current |
| Marks | `marks.ts` | Lasers, measures and cursors with the plugin's overlays; the player's own laser, line, circle and cone, kept on the map while Persist Measurements is on |
| Annotations | `annotations.ts` | Drawings and texts the GM shares |
| Pins | `annotations.ts` | Pins with the plugin's icons; opening a readable pin sends `pin-found` |
| Shown image | `shownImage.ts` | The image the GM shows, full screen |
| Initiative | `initiative.ts` | The GM's order, the turn marked, hidden names as `?` |
| Widgets | `widgets.ts` | Counters, clocks and timers; a running timer counts on its own |
| Dice | `dice.tsx` | Rolls thrown in 3D with the plugin's `DiceRollStack` |
| Chat and dice log | `logPanel.ts` | The plugin's `TableLogPanel` with `LogState` |
| Book | `book.ts`, `book*.ts` | Character with editable resources, items the player adds, changes and takes away (`book-item-put`, `book-item-delete`, those the GM handed over too; `bookItems.ts`), equipment slots (equip, hide default slots, add own ones), free notes, quests with their whole text and images, notes on a quest, purse, world map with the maps its entrances lead into and the player's own pins. The GM takes a write without answering, so the page applies it to its own copy with the plugin's `applyBookMessage` (on the message as the GM's parser cleans it); a refused write is answered with the whole book |
| Character sheet | `statblockPage.ts`, `statblock*.ts`, `statblock.scss` | The book's Fiche tab: the character's statblock as the GM's Atlas draws it (`book-statblock`): name, header plates, sections, rows, tabs, values, tables with their worked-out rows, tracks, counters, abilities, refills and recovery buttons, laid out in the GM's card's columns. A value the GM lets the player change is an input of its kind, sent when the player leaves it or presses Enter (`book-field`, a table's cell alone with `cell`); words and labelled values are added and taken out one by one (`book-list`); abilities of the player's lists are added, changed and removed (`book-ability`); a counter's boxes send the whole block back (`book-field`); a value or track that is a resource of the character steps it (`book-resource`); a refill is taken at once (`book-refill`); a rest is asked of the GM through its form, with its spends and the actions of its steps (`book-rest`), and the GM's answer is told (`book-rest-answer`). Every change waits for the GM's next statblock; what is being typed stays until the value it was typed against changes. A value, cell or pair with a roll rolls it, named after it. Read only where the statblock is not editable |
| Compendium | `bookCompendium.ts`, `markdownText.ts`, `deviceKey.ts` | The compendium pages the GM shared with this player, in folders by book then kind, read as cards and changed where the GM lets them; the notes the GM linked to the character, opened in the reader |
| Sheet and compendium | `sheetCompendium.ts` | The plugin's `SheetCompendiumBar` above an editable statblock: its pickers ask the GM for a kind's entries (`sheet-choices`), take one (`sheet-pick`) and open one (`sheet-view`) |
| Found notes | `reader.ts`, `documentView.ts` | The note a found pin lets players read, opened from the log or the pin |
| Notices | `notice.ts` | A new item, a refused roll, a roll without a scene, a book that is full |
| Words | `text.ts` | Every text the page writes itself |

The chat panel is in English: the plugin's French covers only the statblock panel.

On a screen under 640 px wide the toolbar takes a row of its own under the log's and the book's buttons, and the widget bar sits above them instead of at the top.

The log stays open beside the book and the toolbar: a press in anything marked `data-keeps-log-open` is no press outside it (`LOG_KEEPS_OPEN` in the plugin's `usePanelDismissal.ts`).

### Character sheets

A character sheet is a native statblock note of one of the two built-in 5E character templates:
`atlas-template: builtin:5e-2024-character` or `builtin:5e-2014-character`
(`src/app/statblocks/presets/fiveECharacter.ts`, fields in `fiveECharacterFields.ts`, in French). Both have
the same fields and work out the same values; the 2014 template says Race and Inspiration where the 2024
one says Espèce and Inspiration héroïque. The GM switches a sheet from one to the other with Règles above
it (`src/app/sheets/editionSwitch.ts`), keeping every value; players cannot. What the character carries and
its coins are not on the sheet: they are its book's. Saving throws, skills (proficiency once, expertise
twice, with `has(…)` in formulas), passive Perception and the spell DC are worked out where the card shows
them; `class`, `level`, `hit_dice` (from the `classes` entries), `proficiency` and `initiative` are fields
with `derive`, written into the note after every change (`src/app/statblocks/notes/derivedFields.ts`), so
Atlas's initiative and hit points read them. `atlas-player-notes` lists the notes linked for the
character's player as `[[links]]`. A sheet of the former engine (`atlas-sheet: dnd5e-2024`) is moved onto
the template in place at every start (`src/app/sheets/migrateSheets.ts`, rules in `sheetMigration.ts`).

The GM's sheet is the statblock panel beside the note (`src/app/sheets/CharacterSheetTabs.tsx` around
upstream's pane): tabs Fiche (the rules, the compendium's buttons and the statblock), Livre and Documents.
It opens from a token's menu in the library or on the map (Créer / Ouvrir la fiche de personnage), from
Link Statblock (Créer une fiche de personnage, or linking a note that is a sheet), when a token is made in
the Players tab without a statblock role, when a token is made a player character, and with the commands
Nouvelle fiche de personnage and Ouvrir la fiche de personnage de cette note. New sheets go to
`Personnages/`. The Documents tab links notes for the player.

The sheet's Livre tab (`SheetBook.tsx`) is the GM's way into the character's book: its items and purse,
which the GM adds to, changes and takes from. It needs online play on, which keeps the books
(`activeShelf.ts`). The book is found by the tokens linked to the note (and its `image`): every
collection's book of that artwork, else a new one in the collection of its first token. A write from there
is kept as the GM's (`BookShelf.keep(…, 'gm')`), and `BookShare` sends the whole book at once to whoever
plays that character.

At the table, each player is sent `book-statblock`: the statblock of the character they play, as
the GM's Atlas draws it for them (`src/app/online/gm/book/statblockSheet.ts`), and `character-notes`:
the notes linked for them, sent as found notes are (opening inline, whole text and images by hash,
served to that player alone). Both are sent again when their character, the note or a linked note
changes. A player's `book-field`, `book-list`, `book-ability`, `book-refill` and `book-rest` are checked
against the statblock last sent and written into the note; the next `book-statblock` shows the result.

### Compendium

The compendium is notes in `Compendium/<game system>/<book>/`, installed from source zips
(`src/app/compendium/`, format and build in `compendium/README.md`). A campaign lists the sources it uses
in `sources` (source ids such as `dnd5e-2014/srd-5.1`); its page shows them under Compendium, whose picker
also opens when the campaign is created. Atlas offers SRD 5.1 and SRD 5.2.1 in English, downloaded from the
GitHub release `compendium-v1` and checked against the size and SHA-256 in `officialSources.ts`. An install
writes a record to `atlas-vtt/compendium/`; an update or a removal never touches a file the GM changed. A
folder `Compendium/<system>/<book>` exports as a personal source from its file menu. The asset manager's
Compendium tab (`src/app/packages/components/asset-manager/compendium/`) lists a campaign's entries, shows
the selected one, and makes, opens, deletes, exports and shares; `compendium/README.md` describes it. The
character sheet does not read the compendium yet.

The GM shares compendium pages with the vault's players (`src/app/players/`, kept in `atlas-vtt/players.json`).
After every welcome, and when the GM comes back, the player's page sends `identify` with its device key
(`deviceKey.ts`, kept in the browser for every table). The GM's `CompendiumShare`
(`src/app/online/gm/compendium/`) finds the player by the key's SHA-256, a new player for a device never
seen, and sends `compendium`, the list of their pages, by an id that is never the note's path. It sends it
again when the shares or a note change. `compendium-open` asks for a page whole (`compendium-entry`). A change
of a page the player may write goes as `compendium-edit` in parts of 1,000 characters at most, since a
player's frame holds 4 KiB. The GM checks the access once the change is whole, writes the note, and answers
`compendium-saved`. The book's **Compendium** tab (`bookCompendium.ts`) lists the pages by kind and draws a page
as a card, its text with `markdownText.ts`, which builds elements and text nodes and never markup. The book's
button shows once the player has a book or a shared page.

### What players make on the map

Players draw and write with `draw`, `place-text` and `erase` (`src/app/online/protocol/annotate.ts`). The GM's `PlayerAnnotations` (`src/app/online/gm/PlayerAnnotations.ts`) keeps each as Atlas's own drawing or text, with the key `drawing_player_<id>` or `text_player_<id>` and `author` set to the player's relay id, so the GM sees it, saves it with the map and can erase or undo it (each is one undo step). `annotations` then carries `id` and `by` for a player's own. A player erases only their own; each keeps at most `MAX_PLAYER_ANNOTATIONS` (400) in a scene, within 10 % past the map's edges, at 20 a second (burst 60). A stroke longer than `MAX_STROKE_POINTS` (150) goes as several, since a player's frame holds 4 KiB.

A player's roll may name `advantage` (`advantage` or `disadvantage`); the GM rolls it by the collection's dice set, as the GM's own tray does. `rules.dice.sides` names the sides the map's set has a rule for, which the player's tray offers (both while a GM names none).

A player of the campaign is sent their own code once, when the GM makes it (`your-code`); the page shows it for 30 s. With it, typed in the join form's code field, they take their seat from another device.

The browser tests build nothing themselves: run `npm run player:build` first. They serve the built
page from a real relay, drive it in `/usr/bin/chromium`, and play the GM with the plugin's
`TableConnection`. They are skipped where Chromium or the build is missing.

| Test | What it checks |
|---|---|
| `tests/player.browser.test.ts` | Map pixels under and outside the fog, token bars, a drag, chat, marks, the shown image, initiative, annotations, pins, widgets, dice |
| `tests/lighting.browser.test.ts` | Dark before sight arrives, lit and dark sides of a wall, doors, sensed tokens, explored memory, blindness, daylight |
| `tests/book.browser.test.ts` | Every page of the book, each write reaching the GM and showing without an answer, the world map's levels and pins, quest images, found notes, a refused roll; markup in names stays text |
| `tests/diagnostics.test.ts` | Feedback and error reports kept in the data folder; malformed, too large, web-page and flooding requests refused |
| `tests/phone.browser.test.ts` | At 390 × 844, every control on screen and apart; a touch drag moves the own token |
| `tests/compendium.browser.test.ts` | The Compendium tab: the player known by their device, their pages by kind, a monster and a spell read as cards, a change written into the note, a page taken back, the same player after a reload |
| `tests/statblock.browser.test.ts` | The Fiche tab: the statblock drawn, a field, a roll from a worked-out modifier, hit points and an ability removal reaching the GM, a class picked through the compendium bar, and a linked document read whole |
| `tests/toolbar.browser.test.ts` | The toolbar's menus, the log open beside the book, and what each tool sends: a pen stroke, a stamp, a text, a partial erase, delete all, a kept circle, the laser's colour, a d20 with advantage. `ATLAS_SHOTS=<dir>` writes screenshots |

## What the player page can import

`tsconfig.shared.json` in the repository root lists the code that runs without Obsidian.
`scripts/check-boundaries.mjs` keeps it that way. Among it:

- `src/app/online/protocol/`: every message type and its parser.
- `src/app/online/tableLog/`: the chat and roll log panel (`TableLogPanel`, `LogState`).
- `src/app/online/marks/` and `src/app/online/movement/`: cursors, lasers, measures, and
  wall collision for moves.
- Parts of `src/app/pixi/lighting/` (`LightingRenderer`, `PlayerView`, the `engine/` folder)
  and of `src/app/pixi/fog/` (`FogCanvasCompositor`): the renderers for lighting and fog.
- `src/app/pixi/mosaicCanvas/mosaicCanvasView.ts` and `pyramid.ts`: the map's types and tile
  geometry only. The tile layer that draws the map (`MosaicCanvasLayer`) is not shared, so the
  page draws the map image itself.
- `src/app/host/dom.ts`: call `installDomHost` before loading modules that create canvases.

A probe that imported eleven of these modules built and ran in Chromium on 2026-10-14.

## Settings that affect latency

- The GM's socket uses loopback and never goes through Cloudflare.
- `perMessageDeflate` is off (`relay/server.ts`): no frame waits for compression.
- `ws` sets `TCP_NODELAY` on every socket, so small frames leave at once.
- The relay reaches players through `cloudflared` on loopback, so a socket's `bufferedAmount` says nothing of a
  player's link. The parts of large messages go as frames the page acks (`relay/outbox.ts`), so a dragged token
  waits behind about a second of them at most instead of a scene's walls.
- Images, texts and videos never cross the table: the GM's Atlas uploads them to the relay's asset store and
  players fetch them over HTTP, served `public, max-age=31536000, immutable`: each browser fetches an object once,
  and a cache in front of the relay may keep it too.

## The asset store

The plugin's asset store (`src/app/online/gm/assets/`) on the relay (`relay/assetStore.ts`). On the GM side,
with the GM's token: `GET /api/assets/salt` (32 bytes, kept in `asset-salt`), `POST /api/assets/offer`,
`PUT /api/assets/<id>` (one body), `POST /api/assets/<id>/parts`, `PUT /api/assets/<id>/parts/<n>` and
`POST /api/assets/<id>/complete` (objects over 64 MiB, in parts of 16 MiB), `DELETE /api/assets/<id>`. On the
public side, without a token: `GET /api/assets/<id>`. An id is `HMAC-SHA-256(salt, content hash)`: the relay
takes bytes only under the id their SHA-256 names, and the id is the capability to read them.

- Tile pyramids are refused (`kind`): the GM's Atlas then sends maps as images, which the page draws whole.
- All objects hold at most 6 GiB together (`STORE_LIMIT`); the least recently used go first to make room.
- Served with `x-content-type-options: nosniff` and `content-security-policy: default-src 'none'; sandbox`:
  the page fetches them, nothing in them ever runs as a page.

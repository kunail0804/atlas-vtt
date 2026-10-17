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
| Wrong join code | `wrongCode`; 10 within 10 minutes pause joins for 10 minutes (`paused`) | `relay/gate.ts` |
| New join code from the GM | ends the pause and forgets wrong codes | `JoinGate.set` |
| Waiting room | at most `MAX_WAITING` (8), else `tooManyKnocks`; no answer in 5 minutes gives `noAnswer` | `relay/gate.ts` |
| Seats | at most `maxPlayers` connected at once, else `full` | `Table.seat` |
| Player frames | `send` only, at most 4 KB (`tooLarge`), 60 per second after a burst of 120 (`rateLimited`) | `Table.fromPlayer` |
| GM frames | at most 320 KB (`tooLarge`) | `relay/link.ts` |
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
| Assets | `assets.ts` | Asks by hash, takes chunks, checks SHA-256, continues a stalled download, takes scaled copies; quest texts are read with the plugin's `readQuestText` |
| Stage | `stage.ts` | The layers in order: map, grid, tokens, annotations, fog, pins |
| Scene | `sceneView.ts` | Routes every scene message to its layer |
| Map | `mapLayer.ts` | Draws the map at its own size; serves as the grid's `MapImageView` |
| Grid | `sceneView.ts` | The plugin's `GridSystem` |
| Tokens | `tokenLayer.ts`, `tokenUI.ts` | Draws tokens with their bars, conditions and the downed mark; drags the player's own (`drag`, `move`, `drag-cancel`), by mouse or touch; follows `live` and `move-refused` |
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
| Book | `book.ts`, `book*.ts` | Character with editable resources, items, equipment slots (equip, hide default slots, add own ones), free notes, quests with their whole text and images, notes on a quest, purse, world map with the maps its entrances lead into and the player's own pins. The GM takes a write without answering, so the page applies it to its own copy with the plugin's `applyBookMessage` (on the message as the GM's parser cleans it); a refused write is answered with the whole book |
| Found notes | `reader.ts`, `documentView.ts` | The note a found pin lets players read, opened from the log or the pin |
| Notices | `notice.ts` | A new item, a refused roll, a roll without a scene, a book that is full |
| Words | `text.ts` | Every text the page writes itself |

The chat panel is in English: the plugin ships no French locale.

On a screen under 640 px wide the toolbar takes a row of its own under the log's and the book's buttons, and the widget bar sits above them instead of at the top.

The log stays open beside the book and the toolbar: a press in anything marked `data-keeps-log-open` is no press outside it (`LOG_KEEPS_OPEN` in the plugin's `usePanelDismissal.ts`).

### What players make on the map

Players draw and write with `draw`, `place-text` and `erase` (`src/app/online/protocol/annotate.ts`). The GM's `PlayerAnnotations` (`src/app/online/gm/PlayerAnnotations.ts`) keeps each as Atlas's own drawing or text, with the key `drawing_player_<id>` or `text_player_<id>` and `author` set to the player's relay id, so the GM sees it, saves it with the map and can erase or undo it (each is one undo step). `annotations` then carries `id` and `by` for a player's own. A player erases only their own; each keeps at most `MAX_PLAYER_ANNOTATIONS` (400) in a scene, within 10 % past the map's edges, at 20 a second (burst 60). A stroke longer than `MAX_STROKE_POINTS` (150) goes as several, since a player's frame holds 4 KiB.

A player's roll may name `advantage` (`advantage` or `disadvantage`); the GM rolls it by the collection's dice set, as the GM's own tray does. `rules` names the sides the set has a rule for, which the player's tray offers.

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
- `src/app/pixi/mapImage/mapImageView.ts` and `pyramid.ts`: the map's types and tile
  geometry only. The tile layer that draws the map (`MapImageLayer`) is not shared, so the
  page draws the map image itself.
- `src/app/host/dom.ts`: call `installDomHost` before loading modules that create canvases.

A probe that imported eleven of these modules built and ran in Chromium on 2026-10-14.

## Settings that affect latency

- The GM's socket uses loopback and never goes through Cloudflare.
- `perMessageDeflate` is off (`relay/server.ts`): no frame waits for compression.
- `ws` sets `TCP_NODELAY` on every socket, so small frames leave at once.

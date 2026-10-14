# Relay reference

The relay is one Node process with two HTTP listeners. Both bind to `127.0.0.1`
(`relay/config.ts`).

| Side | Port | Reached by | Serves |
|---|---|---|---|
| GM | 8787 | The plugin, over loopback | Sign-in, `/api/me`, table creation, the GM's socket |
| Public | 8788 | Players, through the Cloudflare Tunnel | The player page, `/health`, players' sockets |

The plugin's addresses are in `src/app/online/gm/servers.ts`: `RELAY_ORIGIN` and
`ACCOUNTS_ORIGIN` name the GM side, `PLAYER_ORIGIN` names the public side. A join link is
`PLAYER_ORIGIN/#<table code>` (`OnlineTable.link`).

## Routes

### GM side

| Route | File | State |
|---|---|---|
| `POST /auth/device/code` | `relay/account.ts` | Done. Answers a device code. |
| `POST /auth/device/token` | `relay/account.ts` | Done. Answers the GM's token at once. |
| `POST /auth/sign-out` | `relay/account.ts` | Done. Answers 200. |
| `GET /api/me` | `relay/account.ts` | Done. 401 without the GM's token, else the local account with `maxPlayers: MAX_PLAYERS`. |
| `GET /account` | `relay/account.ts` | Done. A page that says the sign-in worked. |
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

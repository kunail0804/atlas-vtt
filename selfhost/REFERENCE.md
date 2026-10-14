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
| `POST /api/tables` | `relay/tables.ts`, `createTable` | To write. Answers 501. |
| Socket `/api/tables/<code>/socket` | `relay/tables.ts`, `joinTable` | To write. Closes with 1011. |

The GM's token is stored in `selfhost/.local/host-token` (mode 600). Delete that file to sign
the plugin out.

### Public side

| Route | File | State |
|---|---|---|
| `GET /health` | `relay/server.ts` | Done. Answers `ok`. |
| `GET` any other path | `relay/staticFiles.ts` | Done. Serves `player/dist`. Unknown and malformed paths get `index.html`. |
| Socket `/api/tables/<code>/socket` | `relay/tables.ts`, `joinTable` | To write. Closes with 1011. |

A socket path whose code does not match `TABLE_CODE_PATTERN` gets HTTP 404 before the upgrade.

## What `createTable` must answer

Status 201 with this body (`readCreated` in `src/app/online/gm/createdTable.ts`):

| Field | Rule |
|---|---|
| `code` | Matches `TABLE_CODE_PATTERN`: 26 characters of `a-z2-7`. |
| `secret` | Matches `SECRET_PATTERN` and has at least 32 characters. |
| `maxPlayers` | A whole number from 1. The plugin reads `MAX_PLAYERS` when it is missing. |

Any other status is a refusal. The plugin shows the body's `error` to the GM.

## What `joinTable` must do

All frames are JSON text with `v: 1` (`PROTOCOL_VERSION`). The types are in
`src/app/online/protocol/relay.ts`. `parseClientFrame` reads what a client sends.

- The first frame is a `hello`. The GM's has `role: 'gm'` and the table's `secret`, and must
  arrive on the GM side. A player's has `role: 'player'`, a `name`, and either the `key` the
  relay gave them before or the join `code`.
- The relay answers `welcome`: to the GM with the connected and waiting players, to a player
  with their `id`, their `key`, and whether the GM is online.
- `gate`, `admit`, `decline`, `kick`, and `end` come from the GM only. With `ask` set in the
  last `gate`, a newcomer gets `waiting` and the GM gets `knock` until they answer.
- A `send` from a player goes to the GM as `game` with `from` set to the player's id. A
  `send` from the GM goes to the player named in `to`, or to every player when `to` is
  `ALL_PLAYERS`. The relay never reads `body`.
- The relay closes sockets with the codes in `CLOSE` (4001 to 4016). The GM's page and the
  players' page stop reconnecting after the codes in `FINAL_CLOSE_CODES`.
- Limits: `MAX_GM_FRAME` (320 KB), `MAX_PLAYER_FRAME` (4 KB), `MAX_PLAYERS` (12),
  `MAX_WAITING` (8), `MAX_PLAYER_NAME` (32). Clients send `ping` every `KEEPALIVE_MS`
  (30 s), and the relay answers `pong`.

The GM's side of these exchanges is in `src/app/online/gm/TableConnection.ts` and
`src/app/online/gm/joinGate.ts`.

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

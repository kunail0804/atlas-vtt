# Run the self-hosted relay

This folder holds the relay and the player page that let players join an Atlas VTT table
through `https://vtt.kunlab.cc`, with the relay running on the GM's own machine. The plugin
itself lives in the repository root. For what each route does and what is left to write, see
[the relay reference](REFERENCE.md).

## Requirements

- Node 24 or later. The relay runs its TypeScript files directly, without a build.
- The repository root's dependencies. The player page uses the root's Vite, React and PixiJS.
- `cloudflared` and a tunnel named `atlas-vtt`, for players outside this machine. See
  [Expose the public side](#expose-the-public-side).

## Install

Run these commands from the `selfhost` folder:

```sh
npm ci --prefix ..
npm ci
```

## Develop

1. Start the relay. It restarts when a file under `relay/` changes:

   ```sh
   npm run relay
   ```

   You see the two listeners:

   ```
   GM side      http://127.0.0.1:8787  (loopback only)
   Public side  http://127.0.0.1:8788  (forwarded by the tunnel)
   ```

2. In a second terminal, start the player page with hot reload:

   ```sh
   npm run player:dev
   ```

   Open `http://127.0.0.1:5173/#<table code>`. Vite forwards `/api` and the sockets to the
   relay's public side, so the page behaves as it does behind the tunnel.

3. Check the types, and run the relay's tests:

   ```sh
   npm run typecheck
   npm test
   ```

## Build and install the plugin

The plugin talks to the relay over loopback (`src/app/online/gm/servers.ts`). To install a
build in a vault, run from the repository root:

```sh
npm run build:ci
cp dist/main.js dist/styles.css manifest.json <vault>/.obsidian/plugins/atlas-vtt/
```

Reload Obsidian after the copy. Do not click **Update** on Atlas VTT in Obsidian's community
plugins: it replaces this build with the official one, which talks to `atlas-vtt.dev`.

## Play

1. Build the page and start the relay. The relay then serves the built page itself:

   ```sh
   npm start
   ```

2. Start the tunnel: `cloudflared tunnel run atlas-vtt`.
3. In Obsidian, turn on **Online play** under **Experimental features** in the command
   palette, sign in from the online control, and start a table. The sign-in completes at
   once: the relay answers it on loopback.

## Expose the public side

The tunnel forwards `vtt.kunlab.cc` to the public side, port 8788, and nothing else. The GM
side, port 8787, never leaves the machine. `cloudflared/config.example.yml` holds the
configuration to copy to `~/.cloudflared/config.yml`.

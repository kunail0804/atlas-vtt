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

## Build the campaign image

The image holds the relay, the built player page, the plugin build the launcher copies into a
vault, and `cloudflared` 2026.10.0 (checked against its published SHA-256). Build it from the
repository root:

```sh
docker build -f selfhost/Dockerfile -t kunail0804/atlas-relay:dev .
```

The launcher runs it like this, one container per campaign:

```sh
docker run --rm -p 127.0.0.1:8787:8787 -v atlas-<campaign>:/data \
  -e PLAYER_ORIGIN=https://<campaign>-vtt.kunlab.cc -e TUNNEL_TOKEN=<token> kunail0804/atlas-relay
```

Only the GM side (8787) is published, on the host's loopback. `cloudflared` reaches the public side
(8788) inside the container. The relay stops after `IDLE_STOP_MINUTES` (5 in the image) with no
socket open, and when the tunnel stops; `--rm` then deletes the container and the token with it.
Tables live in the `atlas-<campaign>` volume.

## Expose the public side

The tunnel forwards `vtt.kunlab.cc` to the public side, port 8788, and nothing else. The GM
side, port 8787, never leaves the machine. `cloudflared/config.example.yml` holds the
configuration to copy to `~/.cloudflared/config.yml`.

## Deploy the campaigns service

The service (`service/`) runs on Cloudflare Workers with D1 at `https://campaigns.kunlab.cc`. It
reads its secrets from `~/.config/atlas-vtt-admin/secrets.env`. Run once `npx wrangler login` in
`service/`, then:

```sh
cd service
npm ci
./setup.sh
```

`setup.sh` creates the database if it is missing, applies `migrations/`, deploys the Worker and
sets its secrets. It is safe to run again after a change.

## Build the launcher

The launcher (`launcher/`) is compiled with Deno, for Linux and for Windows, from Linux:

```sh
cd launcher
deno task build
```

It writes `dist/atlas` and `dist/atlas.exe`. GMs download them from the fork's GitHub Releases;
`atlas man` lists every command.


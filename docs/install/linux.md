# Install Atlas VTT on Linux

This guide takes you from a Linux machine without Atlas to a campaign that your players can join from their
browsers. You install Obsidian and Docker, download the `atlas` launcher, check the file, and start a first
campaign. The launcher speaks French, so this guide quotes its menus in French.

For Windows, see [Install Atlas VTT on Windows](windows.md).

## Check what you need

- A 64-bit x86 Linux machine (`x86_64`) with glibc. The launcher is built for `x86_64-unknown-linux-gnu`
  (`selfhost/launcher/deno.json`). No ARM build exists.
- Obsidian 1.8.7 or later, desktop version (`minAppVersion` in `manifest.json`).
- Docker Engine. Each campaign runs in a container of the `kunail0804/atlas-relay` image.
- A Discord account. The launcher signs you in through Discord.
- An internet connection. The launcher talks to `https://campaigns.kunlab.cc` and downloads the image from
  Docker Hub.

## Install Docker

1. Install Docker Engine for your distribution. The launcher points to the official instructions:
   <https://docs.docker.com/engine/install/>.
2. Start the Docker service:

   ```sh
   sudo systemctl start docker
   ```

3. Run this command **without** `sudo`:

   ```sh
   docker info --format '{{.ServerVersion}}'
   ```

   The command prints a version number. The launcher runs `docker` as your user, without `sudo`, and checks
   the engine with this same command (`selfhost/launcher/docker.ts`).

If step 3 prints a permission error, your user cannot reach the Docker engine yet. Follow Docker's
[post-installation steps](https://docs.docker.com/engine/install/linux-postinstall/) to give it access, then
run step 3 again. Without this, the launcher stops with « Le service Docker ne répond pas ».

## Install Obsidian and create the campaign's vault

1. Install Obsidian 1.8.7 or later from <https://obsidian.md>.
2. Create a vault for your campaign, or pick an existing one.
3. Open the vault in Obsidian at least once.

The launcher accepts only a folder that contains a `.obsidian` folder, which Obsidian creates the first time
it opens a vault (`selfhost/launcher/vault.ts`).

You do not install the Atlas VTT plugin yourself. The launcher copies the plugin from the image into the vault
on every start.

## Download the launcher

1. Open the fork's releases: <https://github.com/kunail0804/atlas-vtt/releases>.
2. Pick the newest release named **Atlas launcher x.y.z**, with a tag `launcher-v<x.y.z>`.
   - Every launcher release is marked **Pre-release** on GitHub, the stable ones too.
   - Skip the releases whose version ends in `-dev.<n>`. They are development builds from `develop`.
   - Skip the **Compendium sources** releases. They hold data that the plugin downloads by itself.
3. Download two files from that release: `atlas` and `SHA256SUMS`. Put them in the same folder.

## Check the download

`SHA256SUMS` holds the SHA-256 fingerprints of `atlas` and `atlas.exe`. CI writes it in the same job that
builds both files (`.github/workflows/ci.yml`, job `launcher-release`).

1. Open a terminal in the folder that holds both files.
2. Run:

   ```sh
   sha256sum --check --ignore-missing SHA256SUMS
   ```

   The command prints `atlas: OK`. On a system in another language, the word after the colon is translated:
   French prints `atlas: Réussi`.

If the command prints `FAILED`, delete `atlas` and download it again. Do not run a file that fails the check.

GitHub also records a SHA-256 for each file of a release. With the GitHub CLI, `gh release view <tag> -R
kunail0804/atlas-vtt --json assets` prints it as `digest`. It must equal the line for `atlas` in `SHA256SUMS`.

What the check proves: the file you have is the file CI put in the release. `SHA256SUMS` comes from the same
release, so the check does not protect you if someone replaced the release itself. The launcher is not
signed: the release job builds and uploads it without a signing step.

## Start the launcher

1. Make the file executable, then start it:

   ```sh
   chmod +x atlas
   ./atlas
   ```

2. Check the version it prints in the title line: `══════════ ATLAS 0.4.0 ══════════` for release 0.4.0.
   You can also run `./atlas version`.

Without a command, the launcher shows a menu and waits for a number. With a command, it runs that command and
exits. `./atlas man` lists every command.

## Sign in

1. In the menu, type `1` (« Se connecter avec Discord »).
2. The launcher prints a code and opens your browser with `xdg-open`. Check that the page shows the same code.
   If no browser opens, copy the link that the launcher prints into your browser.
3. Allow Atlas on Discord, then go back to the terminal.

The first sign-in creates your account with the status « en attente de validation par l'administrateur ».
You cannot create or start a campaign until the administrator approves the account. Ask the administrator to
approve it, then check its status:

```sh
./atlas status
```

The line must say « compte validé ».

## Create and start a campaign

1. Create the campaign:

   ```sh
   ./atlas campaign create <name>
   ```

   A name has 1 to 30 lowercase letters, digits, or hyphens. An account holds 5 campaigns at most. The
   launcher prints the players' address, `https://<name>-vtt.kunlab.cc`.

2. Start it:

   ```sh
   ./atlas start <name>
   ```

3. The first time, the launcher asks for the campaign's vault. It opens a folder dialog with `zenity` or
   `kdialog` when one of them is installed. Otherwise it asks you to type the path. Choose the vault folder,
   the one that contains `.obsidian`. The launcher remembers it for this campaign.
4. Wait while the launcher downloads the image, copies the plugins into the vault, and starts the container.

When the start succeeds, the launcher prints:

```
La campagne « <name> » tourne.
Adresse des joueurs : https://<name>-vtt.kunlab.cc  (copiée)
```

`(copiée)` means that the address is on your clipboard. The launcher tries `wl-copy`, `xclip`, then `xsel`.
Without any of them, copy the address from the terminal.

The start also puts Fantasy Statblocks in the vault when the vault has none or an older one, and switches both
plugins on in `.obsidian/community-plugins.json`.

## Open the table in Obsidian

1. If Obsidian was open on the vault, close it and open it again. The plugins changed while it ran.
2. If Obsidian shows community plugins as disabled, open **Settings → Community plugins** and turn off
   **Restricted mode**.
3. Open the command palette, go to the **Experimental features** page, and turn on **Online play**.
4. Sign in from the online control at the bottom left of the map.
5. Run **Start online table** from the command palette. Obsidian shows the full invitation link.

## Check that everything works

- `./atlas status` prints « Campagne en cours : <name>. »
- `docker ps --filter name=atlas-campaign-` lists one container, `atlas-campaign-<name>`.
- Open `http://127.0.0.1:8787/api/me` in a browser on the same machine. The relay answers
  `{"error":"signed-out"}`, because the browser is not Obsidian (`selfhost/relay/account.ts`). That answer
  shows that the relay runs. The launcher waits for this address before it reports the start
  (`waitForRelay` in `selfhost/launcher/docker.ts`).
- A player opens the invitation link from another network and joins the table.

The relay listens on `127.0.0.1:8787` only. The players reach the campaign through a Cloudflare tunnel that
the container opens itself, so you do not open a port on your router.

## Stop a campaign

Run `./atlas stop`. A campaign also stops by itself 5 minutes after the last player leaves. The tables stay in
the Docker volume `atlas-<name>`.

## Where the launcher keeps its files

| What | Where |
|---|---|
| Your session, campaigns, and update check | `$XDG_CONFIG_HOME/atlas-vtt/`, or `~/.config/atlas-vtt/` when `XDG_CONFIG_HOME` is not set |
| The log | `atlas.log` in that folder |
| A campaign's tables | The Docker volume `atlas-<name>` |
| The plugins | `<vault>/.obsidian/plugins/atlas-vtt/` and `<vault>/.obsidian/plugins/obsidian-5e-statblocks/` |

If the launcher reports « Une erreur inattendue s'est produite », send `atlas.log` to the administrator.

## Update

- **The plugin and the relay:** every `atlas start` downloads the newest `latest` image and copies its plugin
  into the vault. You do nothing.
- **The launcher:** at most once a day, the launcher checks the fork's releases and tells you when a newer
  version exists. Download the new `atlas` and `SHA256SUMS`, and check them as in
  [Check the download](#check-the-download).

Do not click **Update** on Atlas VTT in Obsidian's community plugins. It replaces the fork's plugin with the
official one, which talks to `atlas-vtt.dev`.

## Try a development build

`./atlas start <name> --dev` runs the `dev` image that CI publishes from `develop`, with its plugin. The vault
keeps the plugin of the last start, so use a separate campaign on a test vault for `--dev`.

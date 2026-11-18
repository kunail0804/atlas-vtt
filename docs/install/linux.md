# Install Atlas VTT on Linux

This guide takes you from a Linux machine without Atlas to a campaign that your players can join from their
browsers. You install Obsidian and Docker, download the `atlas` launcher, check the file, and start a first
campaign. The launcher speaks French, so this guide quotes its messages in French, each followed by what it
means. Atlas itself, inside Obsidian, is mostly in English, even in an Obsidian set to French.

For Windows, see [Install Atlas VTT on Windows](windows.md).

## Check what you need

- A 64-bit x86 Linux machine (`x86_64`) with glibc. The launcher is built for `x86_64-unknown-linux-gnu`
  No ARM build exists.
- Obsidian 1.8.7 or later, desktop version.
- Docker: Docker Engine or Docker Desktop for Linux. Each campaign runs in a container of the
  `kunail0804/atlas-relay` image.
- A Discord account. The launcher signs you in through Discord.
- An internet connection. The launcher talks to `https://campaigns.kunlab.cc` and downloads the image from
  Docker Hub.

## Install Docker

Docker's site offers two products for Linux: **Docker Engine** (a system service) and **Docker Desktop** (an
application with a window, which runs its own engine for your user). Either works. Pick one and keep to it:
they are started in different ways.

### With Docker Engine

1. Install Docker Engine for your distribution: <https://docs.docker.com/engine/install/>.
2. Start the Docker service:

   ```sh
   sudo systemctl start docker
   ```

### With Docker Desktop

1. Install Docker Desktop for Linux: <https://docs.docker.com/desktop/setup/install/linux/>.
2. Open Docker Desktop and wait until it shows **Engine running**. From a terminal, the same is
   `systemctl --user start docker-desktop`, without `sudo`.

`sudo systemctl start docker` does not start Docker Desktop. To see which one the `docker` command talks to,
run `docker context show`: `desktop-linux` is Docker Desktop, `default` is Docker Engine.

### Check that Docker answers

Run this command **without** `sudo`:

```sh
docker info --format '{{.ServerVersion}}'
```

The command prints a version number. The launcher runs `docker` as your user, without `sudo`, and checks the
engine with this same command. When Docker does not answer, the launcher says what to do for the Docker you
use:

| The launcher says | Meaning | What to do |
|---|---|---|
| « Docker Desktop n'est pas démarré » | Docker Desktop is not running. | Open Docker Desktop and wait for **Engine running**. |
| « Le service Docker ne répond pas » | Docker Engine's service is not running. | `sudo systemctl start docker` |
| « Ton utilisateur n'a pas le droit d'utiliser Docker » | Your user cannot reach Docker Engine. | Follow Docker's [post-installation steps](https://docs.docker.com/engine/install/linux-postinstall/), then log out and in again. |

## Install Obsidian and create the campaign's vault

1. Install Obsidian 1.8.7 or later from <https://obsidian.md>.
2. Create a vault for your campaign, or pick an existing one.
3. Open the vault in Obsidian at least once, then close Obsidian.

The launcher accepts only a folder that contains a `.obsidian` folder, which Obsidian creates the first time
it opens a vault.

You do not install the Atlas VTT plugin yourself. The launcher copies the plugin from the image into the vault
on every start.

## Download the launcher

1. Open the newest launcher release: <https://github.com/kunail0804/atlas-vtt/releases/latest>. Its title is
   **Atlas launcher x.y.z** and GitHub marks it **Latest**.
   - On the full list of releases, skip the ones marked **Pre-release**: the launcher builds whose version
     ends in `-dev.<n>` are development builds, and **Compendium sources** hold data that the plugin downloads
     by itself. Launcher releases up to 0.4.0 are marked **Pre-release** too.
2. Unfold **Assets** at the bottom of the release if GitHub folds it, and download two files: `atlas` and
   `SHA256SUMS`. Put them in the same folder. You do not need the source code archives.

## Check the download

`SHA256SUMS` holds the SHA-256 fingerprints of `atlas` and `atlas.exe`. It is built together with both files
and published in the same release.

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

What the check proves: the file you have is the file published in the release. `SHA256SUMS` comes from the
same release, so the check does not protect you if someone replaced the release itself. The launcher is
not signed.

## Start the launcher

1. In a terminal, in the folder that holds `atlas`, make the file executable, then start it:

   ```sh
   chmod +x atlas
   ./atlas
   ```

2. Check the version it prints in the title line: `══════════ ATLAS 0.5.0 ══════════` for release 0.5.0.
   You can also run `./atlas version`.

Without a command, the launcher shows a menu and waits for a number. `0`, **Ctrl+C** or **Ctrl+D** leaves it.
With a command, it runs that command and exits. `./atlas man` (or `./atlas -h`) lists every command.

Start the launcher from a terminal, not by double-clicking it in a file manager: without a terminal, it prints
« Le menu d'Atlas a besoin d'un terminal » (the menu needs a terminal) and stops.

## Sign in

1. In the menu, type `1` (« Se connecter avec Discord »).
2. The launcher prints a code and opens your browser with `xdg-open`. Check that the page shows the same code.
   If no browser opens, copy the link that the launcher prints into your browser.
3. Allow Atlas on Discord, then go back to the terminal.

`./atlas login` does the same from the command line. When you are signed in already, it says so (« Tu es déjà
connecté ») and opens no page: to change accounts, run `./atlas logout`, then `./atlas login`.

The first sign-in creates your account with the status « en attente de validation par l'administrateur »
(waiting for the administrator's approval). You cannot create or start a campaign until the administrator
approves the account.

- The administrator is the person who runs the campaigns service, `campaigns.kunlab.cc`, and gave you access
  to Atlas. There is no automatic approval.
- The service sends them a message on Discord when your account is created. If nothing happens, contact them
  the way they invited you.
- Signing in again does not speed it up. Check the status from time to time:

  ```sh
  ./atlas status
  ```

  The line must say « compte validé » (account approved).

## Create and start a campaign

1. Create the campaign:

   ```sh
   ./atlas campaign create <name>
   ```

   A name has 1 to 30 lowercase letters, digits, or hyphens, and does not start or end with a hyphen. When a
   name breaks a rule, the launcher says which one and proposes a name that keeps them: `./atlas campaign create
   Ma campagne` answers « Essaie « ma-campagne » » (try `ma-campagne`) and creates nothing. An account holds 5
   campaigns at most. The launcher prints the campaign's address, `https://<name>-vtt.kunlab.cc`.

2. Start it:

   ```sh
   ./atlas start <name>
   ```

3. The first time, the launcher asks for the campaign's vault. It opens a folder dialog with `zenity` or
   `kdialog` when one of them is installed. Otherwise it asks you to type the path: `~/Documents/my-vault`
   and a path pasted between quotes are understood. Choose the vault folder itself, the one that contains
   `.obsidian`, not the folder that holds it. The launcher remembers it for this campaign, and warns you when
   another campaign uses the same vault.
4. Wait while the launcher downloads the image, copies the plugins into the vault, and starts the container.

To give a campaign another vault later, run `./atlas campaign vault <name>` (menu: « Changer le coffre d'une
campagne »). The next start puts the plugins in the new vault.

When the start succeeds, the launcher prints what to do next:

```
La campagne « <name> » tourne, avec le coffre <vault>.
Pour inviter les joueurs : dans Obsidian, ouvre ce coffre, lance la table (« Start online table »), puis clique sur « Copy invite link » :
Atlas copie le lien d'invitation sans l'afficher. C'est ce lien que tu envoies aux joueurs.
L'adresse de la campagne, https://<name>-vtt.kunlab.cc, ne suffit pas : sans le lien d'invitation, les joueurs n'y trouvent pas de table.
Elle s'arrête toute seule si personne ne s'y connecte dans l'heure, puis 5 minutes après le départ de tout le monde.
```

In English: the campaign runs with that vault; to invite the players, open the vault in Obsidian, start the
table, and click **Copy invite link**, which copies the link without showing it; send that link to your
players, because the campaign's address alone leads to no table; and the campaign stops by itself (see
[Stop a campaign](#stop-a-campaign)).

The first start also puts Fantasy Statblocks in the vault when the vault has none or an older one, and
switches both plugins on in `.obsidian/community-plugins.json`. The launcher then lists those changes and
reminds you of Obsidian's trust dialog, described below.

## Open the table in Obsidian

Do these steps within the hour after `./atlas start`: a campaign nobody joined within an hour stops by itself.

1. If Obsidian was open on the vault, close it and open it again. The plugins changed while it ran.
2. The first time Obsidian opens a vault that holds community plugins, it asks whether to trust the vault's
   author (in a French Obsidian: « Faire confiance à l'auteur de ce coffre ? »). Obsidian recommends
   restricted mode, and that button is selected, so **Enter** chooses it. Click **Trust author and enable
   plugins** instead (« Faire confiance à l'auteur et activer les modules »): in restricted mode, Atlas does
   not load.
3. Obsidian then opens its settings on **Community plugins**, where Atlas VTT and Fantasy Statblocks are
   switched on. Close the settings window.

   If you chose restricted mode by mistake, open **Settings → Community plugins** and turn off **Restricted
   mode**.
4. Open the Atlas dashboard: press **Ctrl+P** to open Obsidian's command palette, type `Atlas`, and run
   **Atlas VTT: Open dashboard**. The dashboard opens in a new tab.
5. From the dashboard, create a scene or resume a recent one. The scene opens in an Atlas map tab.
6. In the map, open the Atlas command palette (**Space**, or its button on the toolbar), go to the
   **Experimental features** page, and turn on **Online play**.
7. Sign in from the online control at the bottom left of the map.
8. Run **Start online table** from the Atlas command palette. It is there only while an Atlas map tab is
   active. The online control opens its start menu.
9. Under **World**, choose the world the table plays, or keep **No world**.
10. Click **Start online table** at the bottom of the menu.

If the campaign stopped meanwhile, Atlas says that the campaign is not running on this machine. Run
`./atlas start <name>` again, then start the table.

## Invite the players

Open the online control and click **Copy invite link**. Atlas copies the link to your clipboard and does not
show it. Paste it where your players read it (Discord, e-mail).

The campaign's address, `https://<name>-vtt.kunlab.cc`, is not that link. Opened on its own, it shows « Ce lien
ne contient pas de table. Demande le lien d'invitation au MJ. » (this link holds no table; ask the GM for the
invite link).

## Check that everything works

- `./atlas status` prints « Campagne en cours : <name>. »
- `docker ps --filter name=atlas-campaign-` lists one container, `atlas-campaign-<name>`.
- Open `http://127.0.0.1:8787/api/me` in a browser on the same machine. The relay answers
  `{"error":"signed-out"}`, because the browser is not Obsidian. That answer shows that the relay runs. The
  launcher waits for this address before it reports the start.
- A player opens the invitation link from another network and joins the table.

The relay listens on `127.0.0.1:8787` only. The players reach the campaign through a Cloudflare tunnel that
the container opens itself, so you do not open a port on your router.

## Stop a campaign

Run `./atlas stop`. A campaign also stops by itself:

- one hour after `./atlas start` if nobody connected to it, you included;
- 5 minutes after everyone left, once someone connected.

The tables stay in the Docker volume `atlas-<name>`. Start the campaign again with `./atlas start <name>`.

While the campaign is stopped, players who open its address see a Cloudflare error page, in English, « Error
1033 — Cloudflare Tunnel error ». It means that the campaign is not running, not that something is broken.

## Delete a campaign

`./atlas campaign delete <name>` (menu: « Supprimer une campagne ») asks for confirmation, then deletes the
campaign and its address: nobody can reach it any more. The launcher forgets the campaign's vault, and the vault
itself is left as it is.

The tables stay on this machine, in the Docker volume `atlas-<name>`, so that a mistake does not cost your
work. To delete them too:

```sh
docker volume rm atlas-<name>
```

## Where the launcher keeps its files

| What | Where |
|---|---|
| Your session, the vault of each campaign, and update check | `$XDG_CONFIG_HOME/atlas-vtt/`, or `~/.config/atlas-vtt/` when `XDG_CONFIG_HOME` is not set |
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

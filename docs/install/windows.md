# Install Atlas VTT on Windows

This guide takes you from a Windows machine without Atlas to a campaign that your players can join from their
browsers. You install Obsidian and Docker Desktop, download `atlas.exe`, check the file, and start a first
campaign. The launcher speaks French, so this guide quotes its menus in French.

For Linux, see [Install Atlas VTT on Linux](linux.md).

Nobody has yet followed this guide on their own Windows machine. The GM path was run once in a fresh
Windows 11 VM (build 26100, issue #29). The test on testers' own machines is issue #46. The steps marked
**To check** describe what is not known yet: note what you see.

## Check what you need

- A 64-bit x86 Windows machine. The launcher is built for `x86_64-pc-windows-msvc`
  (`selfhost/launcher/deno.json`). No ARM build exists.
- Obsidian 1.8.7 or later, desktop version (`minAppVersion` in `manifest.json`).
- Docker Desktop. Each campaign runs in a container of the `kunail0804/atlas-relay` image.
- A Discord account. The launcher signs you in through Discord.
- An internet connection. The launcher talks to `https://campaigns.kunlab.cc` and downloads the image from
  Docker Hub.

## Install Docker Desktop

1. Install Docker Desktop. The launcher points to the official instructions:
   <https://docs.docker.com/desktop/setup/install/windows-install/>.
2. Open Docker Desktop and wait until it shows **Engine running**.

During the VM run of issue #29, Docker Desktop asked for two PowerShell commands as administrator, then a
restart:

```powershell
wsl --install
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
```

**To check:** whether Docker Desktop asks for them on your machine too.

The launcher needs the engine to run every time you start a campaign. If Docker Desktop is closed, the
launcher stops with « Docker Desktop n'est pas démarré ». Open Docker Desktop, wait for **Engine running**,
then try again.

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
3. Download two files from that release: `atlas.exe` and `SHA256SUMS`. Put them in the same folder.

## Check the download

`SHA256SUMS` holds the SHA-256 fingerprints of `atlas` and `atlas.exe`. CI writes it in the same job that
builds both files (`.github/workflows/ci.yml`, job `launcher-release`).

1. Open PowerShell in the folder that holds both files.
2. Print the fingerprint of `atlas.exe`:

   ```powershell
   (Get-FileHash .\atlas.exe -Algorithm SHA256).Hash
   ```

3. Print the line for `atlas.exe` in `SHA256SUMS`:

   ```powershell
   Select-String -Path .\SHA256SUMS -Pattern 'atlas.exe'
   ```

4. Compare the two values. `Get-FileHash` prints capital letters and `SHA256SUMS` holds small letters: only the
   case may differ.

If the values differ, delete `atlas.exe` and download it again. Do not run a file that fails the check.

GitHub also records a SHA-256 for each file of a release. With the GitHub CLI, `gh release view <tag> -R
kunail0804/atlas-vtt --json assets` prints it as `digest`.

What the check proves: the file you have is the file CI put in the release. `SHA256SUMS` comes from the same
release, so the check does not protect you if someone replaced the release itself. The launcher is not
signed: the release job builds and uploads it without a signing step.

## Start the launcher

1. Double-click `atlas.exe`. A console window opens with a menu.
2. Check the version in the title line: `══════════ ATLAS 0.4.0 ══════════` for release 0.4.0.

**To check:** because the file is not signed, Windows may show a SmartScreen warning before it runs. Note the
message you see. Run the file only if it passed [Check the download](#check-the-download).

The menu waits for a number. `0` (« Quitter ») closes it. You can also run each command from PowerShell in
the launcher's folder, for example `.\atlas.exe version` or `.\atlas.exe man`, which lists every command.

## Sign in

1. In the menu, type `1` (« Se connecter avec Discord »).
2. The launcher prints a code and opens your browser. Check that the page shows the same code. If no browser
   opens, copy the link that the launcher prints into your browser.
3. Allow Atlas on Discord, then go back to the launcher's window.

The first sign-in creates your account with the status « en attente de validation par l'administrateur ».
You cannot create or start a campaign until the administrator approves the account. Ask the administrator to
approve it. The menu shows the status at the top: it must say « compte validé ».

## Create and start a campaign

1. In the menu, choose « Créer une campagne » and type a name. A name has 1 to 30 lowercase letters, digits,
   or hyphens. An account holds 5 campaigns at most. The launcher prints the players' address,
   `https://<name>-vtt.kunlab.cc`.
2. Choose « Lancer une campagne », then the campaign's number.
3. The first time, a folder dialog opens. Choose the vault folder, the one that contains `.obsidian`. The
   launcher remembers it for this campaign.
4. Wait while the launcher downloads the image, copies the plugins into the vault, and starts the container.

From PowerShell, the same steps are `.\atlas.exe campaign create <name>` and `.\atlas.exe start <name>`.

When the start succeeds, the launcher prints:

```
La campagne « <name> » tourne.
Adresse des joueurs : https://<name>-vtt.kunlab.cc  (copiée)
```

`(copiée)` means that the address is on your clipboard.

The start also puts Fantasy Statblocks in the vault when the vault has none or an older one, and switches both
plugins on in `.obsidian\community-plugins.json`.

**To check:** whether Windows Defender Firewall asks for a permission during the first start. The container
publishes its port on `127.0.0.1` only, and the players reach the campaign through a Cloudflare tunnel that
the container opens itself. Note the program named in the dialog and the choice you made.

## Open the table in Obsidian

1. If Obsidian was open on the vault, close it and open it again. The plugins changed while it ran.
2. If Obsidian shows community plugins as disabled, open **Settings → Community plugins** and turn off
   **Restricted mode**.
3. Open the command palette, go to the **Experimental features** page, and turn on **Online play**.
4. Sign in from the online control at the bottom left of the map.
5. Run **Start online table** from the command palette. Obsidian shows the full invitation link.

## Check that everything works

- The top of the menu shows « Campagne en cours : <name>. »
- Docker Desktop's **Containers** list shows `atlas-campaign-<name>` as running.
- Open `http://127.0.0.1:8787/api/me` in a browser on the same machine. The relay answers
  `{"error":"signed-out"}`, because the browser is not Obsidian (`selfhost/relay/account.ts`). That answer
  shows that the relay runs. The launcher waits for this address before it reports the start
  (`waitForRelay` in `selfhost/launcher/docker.ts`).
- A player opens the invitation link from another network and joins the table.

## Stop a campaign

In the menu, choose « Arrêter la campagne en cours ». A campaign also stops by itself 5 minutes after the
last player leaves. The tables stay in the Docker volume `atlas-<name>`.

## Where the launcher keeps its files

| What | Where |
|---|---|
| Your session, campaigns, and update check | `%APPDATA%\atlas-vtt\` |
| The log | `atlas.log` in that folder |
| A campaign's tables | The Docker volume `atlas-<name>` |
| The plugins | `<vault>\.obsidian\plugins\atlas-vtt\` and `<vault>\.obsidian\plugins\obsidian-5e-statblocks\` |

If the launcher reports « Une erreur inattendue s'est produite », send `atlas.log` to the administrator. To
open the folder, type `%APPDATA%\atlas-vtt` in the address bar of File Explorer.

## Update

- **The plugin and the relay:** every start downloads the newest `latest` image and copies its plugin into the
  vault. You do nothing.
- **The launcher:** at most once a day, the launcher checks the fork's releases and tells you when a newer
  version exists. Download the new `atlas.exe` and `SHA256SUMS`, and check them as in
  [Check the download](#check-the-download).

Do not click **Update** on Atlas VTT in Obsidian's community plugins. It replaces the fork's plugin with the
official one, which talks to `atlas-vtt.dev`.

## Try a development build

`.\atlas.exe start <name> --dev` runs the `dev` image that CI publishes from `develop`, with its plugin. The
menu has no entry for it. The vault keeps the plugin of the last start, so use a separate campaign on a test
vault for `--dev`.

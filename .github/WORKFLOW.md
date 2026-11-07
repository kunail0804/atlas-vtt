# How work reaches the players

This fork is `kunail0804/atlas-vtt`. Its `main` is the product: the plugin, the relay, the player page,
the launcher, the campaigns service and the compendium sources. Every change goes through an issue, a
branch, a pull request and CI, so each one leaves a trace from the request to what was published.

## The path of a change

1. **An issue says what to do.** Use the *Tâche* template: what changes, when it is done, what not to touch.
   Bugs use *Bug*.
2. **A branch from develop**, named `<kind>/<issue>-<few-words>`: `feat/42-dice-sounds`, `fix/57-fog-reload`.
3. **A pull request into develop** whose description starts with `Closes #<issue>` and says how the change was
   verified (`.github/pull_request_template.md`). Nobody pushes to develop or main directly: their rulesets
   refuse it, and refuse a merge whose `Verify` check has not passed.
4. **CI verifies** (`.github/workflows/ci.yml`, the `Verify` check): typecheck, lint, the plugin's unit tests,
   the relay's tests, the player page in Chromium, the launcher's checks and tests, the campaigns service's
   typecheck and bundle. Three of the player page's browser tests (`player`, `toolbar`, `lighting`) fail and
   are left out of CI until they are fixed (issue #2).
5. **Merge into develop**, squashed. `gh pr merge --auto --squash` merges as soon as `Verify` passes. The
   branch is deleted. A branch that carries another history (an upstream sync) is merged with a merge commit.
6. **CI publishes the development build** (below), which you test with `atlas start <name> --dev`.
7. **A release**: a pull request from `develop` into `main`, merged with a merge commit
   (`gh pr merge --merge`), never squashed, or develop and main would part. `Verify` fails a pull request
   into main from any other branch. CI then publishes for the players.

GitHub links `Closes #<issue>` only for a pull request into the default branch: an issue stays open after its
pull request is merged into develop, and closes when the commit that names it reaches main with the release.
The review scripts read the issues from the description themselves (`.github/review/issues.sh`).

`main` stays the default branch: it is what players run.

### What CI publishes

From the pushed commit, only what it changed:

| What changed | develop (for testing) | main (for the players) | Trace |
|---|---|---|---|
| The plugin, the relay or the player page (anything outside the folders below, tests and docs) | Pushes `kunail0804/atlas-relay:<version>-dev.<n>`, `dev` and `sha-<commit>`. `atlas start <name> --dev` takes `dev`. | Pushes `<version>-selfhost.<n>`, `latest` and `sha-<commit>`. `atlas start <name>` takes `latest`. | Git tag `relay-<version>-dev.<n>` or `relay-<version>-selfhost.<n>`; the image's `org.opencontainers.image.revision` label |
| `selfhost/launcher/` | Releases `launcher-v<VERSION>-dev.<n>`, a prerelease installed launchers never offer as an update. | When `VERSION` in `selfhost/launcher/version.ts` has no release yet: releases `launcher-v<VERSION>` with `SHA256SUMS`. Launchers already installed tell the GM a new version is out. | GitHub release, notes listing the launcher's commits |
| `selfhost/service/` | Nothing. | Applies the D1 migrations, deploys the Worker to `campaigns.kunlab.cc`. The Worker's own secrets stay as `selfhost/service/setup.sh` set them. | The run's summary |
| `compendium/builder/` | Nothing. | Builds the SRD sources from the latest 5e-database; if they differ from what Atlas downloads, releases them as `compendium-v<n>` and opens a pull request into develop pointing `src/app/compendium/officialSources.ts` at them. The next release ships them. | GitHub release, the pull request |

Docs, tests and `.github/` alone publish nothing.

### What `atlas start` runs

The image holds the relay, the player page and the plugin built from the same commit. `atlas start <name>`
pulls the image (`latest`, or `dev` with `--dev`), copies its plugin into the campaign's vault
(`.obsidian/plugins/atlas-vtt/`, wherever the files differ; `data.json` is never touched), then starts the
campaign's container. The vault takes whichever plugin the last start brought, so keep a campaign of its own,
on a test vault, for `--dev`.

## Agents and reviews

Agents code on your machine, never on GitHub: you start one on an issue, it follows this file with `gh`
(`gh issue view`, a branch, `gh pr create`, `gh pr merge --auto --squash`).

Reviews run on GitHub (`.github/workflows/review.yml`). The issue chooses the reviewers: the *Reviewers* boxes
of the *Tâche* template, or the labels `review:claude`, `review:glm`, `review:deepseek`.

| Reviewer | Model | Paid by |
|---|---|---|
| `claude` | Claude Sonnet, through Claude Code | your Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`) |
| `glm` | `z-ai/glm-5.3-flash`, through OpenCode | OpenRouter (`OPENROUTER_API_KEY`) |
| `deepseek` | `deepseek/deepseek-v4-flash-0731`, through OpenCode | OpenRouter (`OPENROUTER_API_KEY`) |

- They start when the pull request is opened (or leaves draft), each on its own runner, in parallel. A
  reviewer reads the issue, the pull request and its diff against the branch it goes into, may run the tests and break the
  code to test them, and never pushes. Its instructions are `.github/review/prompt.md`.
- Each report is a comment on the pull request, headed `Review <name>` with the model, the commit, the time
  taken and the cost. The coding agent reads them with `gh pr view <n> --comments`, applies what it agrees
  with, and says in the pull request why it declines the rest.
- A comment `/review glm` (or `claude`, `deepseek`, `all`, several at once) on the pull request runs them again
  on its current head; `/review` alone runs those of the issue. Pushes do not.
- Reports inform and never block a merge: only `Verify` does.

## Upstream

`atlas-vtt/atlas-vtt` stays in sight without being followed:

- Branch `upstream-main` is upstream's main as of the last Monday.
- Every Monday the `upstream` workflow keeps that week's upstream as `upstream-sync-<date>` and opens an issue
  (label `upstream`) with the new commits and the files that would conflict with develop.
- To take something: a branch from develop, `git cherry-pick <commit>` (or copy by hand), a pull request into
  develop.
  Never open a pull request from an `upstream-*` branch: it holds upstream's workflows, which would run on it.

Locally the remote `upstream` points at it: `git fetch upstream`, then `git log develop..upstream/main`.

## Secrets

Set them in *Settings → Secrets and variables → Actions* (`gh secret set <NAME>`). A step whose secret is
missing fails and names it.

| Secret | Used by | What it is |
|---|---|---|
| `DOCKERHUB_TOKEN` | Image | A Docker Hub access token of `kunail0804` with *Read & Write* on repositories (hub.docker.com → Account settings → Personal access tokens). |
| `CLOUDFLARE_DEPLOY_TOKEN` | Service | A Cloudflare API token with *Workers Scripts: Edit*, *D1: Edit*, *Workers Routes: Edit* on the zone `kunlab.cc`. Not the Worker's own token, which is scoped to tunnels and DNS. |
| `CLOUDFLARE_ACCOUNT_ID` | Service | The Cloudflare account id. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Review | `claude setup-token` on your machine: the Claude reviewer runs on your Claude subscription. |
| `OPENROUTER_API_KEY` | Review | An OpenRouter API key (openrouter.ai/settings/keys), with a spending limit. Pays the GLM and DeepSeek reviewers. |
| `AUTOMATION_TOKEN` | Upstream, compendium | A fine-grained personal access token on this repository with *Contents*, *Pull requests*, *Issues* and *Workflows*: read and write. Upstream's history changes workflow files, which the workflow's own token may not push, and a pull request opened with that token starts no CI. Without it the upstream issue still comes, without the branches. |

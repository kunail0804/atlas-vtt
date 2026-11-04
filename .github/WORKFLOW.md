# How work reaches the players

This fork is `kunail0804/atlas-vtt`. Its `main` is the product: the plugin, the relay, the player page,
the launcher, the campaigns service and the compendium sources. Every change goes through an issue, a
branch, a pull request and CI, so each one leaves a trace from the request to what was published.

## The path of a change

1. **An issue says what to do.** Use the *Tâche* template: what changes, when it is done, what not to touch.
   Bugs use *Bug*.
2. **A branch from main**, named `<kind>/<issue>-<few-words>`: `feat/42-dice-sounds`, `fix/57-fog-reload`.
3. **A pull request into main** whose description starts with `Closes #<issue>` and says how the change was
   verified (`.github/pull_request_template.md`). Nobody pushes to main directly: the ruleset on main refuses
   it, and refuses a merge whose `Verify` check has not passed.
4. **CI verifies** (`.github/workflows/ci.yml`, the `Verify` check): typecheck, lint, the plugin's unit tests,
   the relay's tests, the player page in Chromium, the launcher's checks and tests, the campaigns service's
   typecheck and bundle.
5. **Merge**, squashed. `gh pr merge --auto --squash` merges as soon as `Verify` passes. The branch is deleted.
6. **CI publishes** what the merged commit changed, from that commit:

| What changed | What CI does | Trace |
|---|---|---|
| The plugin, the relay or the player page (anything outside the folders below, tests and docs) | Builds `selfhost/Dockerfile`, pushes `kunail0804/atlas-relay:<version>-selfhost.<n>`, `latest` and `sha-<commit>` to Docker Hub. `atlas start` takes `latest`. | Git tag `relay-<version>-selfhost.<n>`; the image's `org.opencontainers.image.revision` label |
| `VERSION` in `selfhost/launcher/version.ts` (a version with no release yet) | Builds `atlas` and `atlas.exe` with Deno, releases them as `launcher-v<VERSION>` with `SHA256SUMS`. Launchers already installed tell the GM a new version is out. | GitHub release, notes listing the launcher's commits |
| `selfhost/service/` | Applies the D1 migrations, deploys the Worker to `campaigns.kunlab.cc`. The Worker's own secrets stay as `selfhost/service/setup.sh` set them. | The run's summary |
| `compendium/builder/` | Builds the SRD sources from the latest 5e-database; if they differ from what Atlas downloads, releases them as `compendium-v<n>` and opens a pull request pointing `src/app/compendium/officialSources.ts` at them. Merging it ships them with the next image. | GitHub release, the pull request |

Docs, tests and `.github/` alone publish nothing.

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
  reviewer reads the issue, the pull request and `git diff origin/main...HEAD`, may run the tests and break the
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
  (label `upstream`) with the new commits and the files that would conflict with main.
- To take something: a branch from main, `git cherry-pick <commit>` (or copy by hand), a pull request into main.
  Never open a pull request from an `upstream-*` branch: it holds upstream's workflows, which would run on it.

Locally the remote `upstream` points at it: `git fetch upstream`, then `git log main..upstream/main`.

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

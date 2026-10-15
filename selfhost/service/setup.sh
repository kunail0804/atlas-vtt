#!/usr/bin/env bash
# Deploys the accounts and campaigns service: D1 database, schema, Worker, secrets.
# Reads ~/.config/atlas-vtt-admin/secrets.env and never prints a secret.
# Needs `npx wrangler login` once. Safe to run again: each step skips what is done.
set -euo pipefail
cd "$(dirname "$0")"

SECRETS="${ATLAS_SECRETS:-$HOME/.config/atlas-vtt-admin/secrets.env}"
[ -r "$SECRETS" ] || { echo "Secrets file not found: $SECRETS" >&2; exit 1; }
set -a; . "$SECRETS"; set +a
for name in DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_WEBHOOK_URL ADMIN_DISCORD_ID CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_ZONE_ID CLOUDFLARE_API_TOKEN; do
  [ -n "${!name:-}" ] || { echo "Missing in $SECRETS: $name" >&2; exit 1; }
done

# Wrangler deploys with its own login (`wrangler login`); the API token in the secrets file is the
# Worker's, scoped to tunnels and DNS only, so it must not reach wrangler.
WORKER_CF_TOKEN="$CLOUDFLARE_API_TOKEN"
unset CLOUDFLARE_API_TOKEN
export WRANGLER_SEND_METRICS=false
export CLOUDFLARE_ACCOUNT_ID
wrangler() { npx --no-install wrangler "$@"; }

wrangler whoami >/dev/null 2>&1 || { echo "Run first: npx wrangler login (in selfhost/service)" >&2; exit 1; }

if grep -q 'database_id = "SET-BY-SETUP"' wrangler.toml; then
  if ! wrangler d1 list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(l.some(d=>d.name==="atlas-campaigns")?0:1)'; then
    echo "Creating the D1 database atlas-campaigns"
    wrangler d1 create atlas-campaigns >/dev/null
  fi
  id=$(wrangler d1 list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));const d=l.find(d=>d.name==="atlas-campaigns");process.stdout.write(d?d.uuid:"")')
  [ -n "$id" ] || { echo "D1 database atlas-campaigns not found after creating it" >&2; exit 1; }
  sed -i "s/database_id = \"SET-BY-SETUP\"/database_id = \"$id\"/" wrangler.toml
  echo "D1 database id written to wrangler.toml"
fi

echo "Applying the schema"
wrangler d1 migrations apply atlas-campaigns --remote

echo "Deploying the Worker"
wrangler deploy

echo "Setting the Worker's secrets"
secret_dir=$(mktemp -d)
trap 'rm -rf "$secret_dir"' EXIT
chmod 700 "$secret_dir"
CF_TOKEN="$WORKER_CF_TOKEN" node -e '
  const keys = ["DISCORD_CLIENT_ID","DISCORD_CLIENT_SECRET","DISCORD_WEBHOOK_URL","ADMIN_DISCORD_ID","CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_ZONE_ID"];
  const out = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  out.CLOUDFLARE_API_TOKEN = process.env.CF_TOKEN;
  require("fs").writeFileSync(process.argv[1], JSON.stringify(out), { mode: 0o600 });
' "$secret_dir/secrets.json"
wrangler secret bulk "$secret_dir/secrets.json"
echo "Done: https://campaigns.kunlab.cc"

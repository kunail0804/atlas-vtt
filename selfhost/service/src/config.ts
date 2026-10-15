import type { Database } from './db.ts';

/** The Worker's bindings: D1, the secrets set with `wrangler secret put`, and the vars of wrangler.toml. */
export interface Env {
  readonly DB: Database;
  readonly DISCORD_CLIENT_ID: string;
  readonly DISCORD_CLIENT_SECRET: string;
  readonly DISCORD_WEBHOOK_URL: string;
  readonly CLOUDFLARE_API_TOKEN: string;
  readonly CLOUDFLARE_ACCOUNT_ID: string;
  readonly CLOUDFLARE_ZONE_ID: string;
  readonly ADMIN_DISCORD_ID: string;
  /** Where this service answers, e.g. https://campaigns.kunlab.cc. */
  readonly PUBLIC_ORIGIN: string;
  /** The zone campaigns are named in, e.g. kunlab.cc: a campaign `name2` is `name2-vtt.kunlab.cc`. */
  readonly CAMPAIGN_DOMAIN: string;
}

export const MAX_CAMPAIGNS_PER_ACCOUNT = 5;
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60_000;
export const DEVICE_LOGIN_MS = 10 * 60_000;
/** A session's last use is written at most this often: every request reads it, few need to write it. */
export const SESSION_TOUCH_MS = 60 * 60_000;

/** 1 to 30 lowercase letters, digits and dashes, no dash at either end: `name2-vtt.kunlab.cc` stays one DNS label. */
export const CAMPAIGN_NAME = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;


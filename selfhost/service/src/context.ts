import type { CloudflareApi } from './cloudflare.ts';
import type { Database } from './db.ts';
import type { DiscordApi } from './discord.ts';

/** Everything a route needs, built once per request by the Worker and by the tests. */
export interface Context {
  readonly db: Database;
  readonly cloudflare: CloudflareApi;
  readonly discord: DiscordApi;
  readonly now: () => number;
  readonly publicOrigin: string;
  readonly campaignDomain: string;
  readonly adminId: string;
}

export interface Account {
  readonly discord_id: string;
  readonly handle: string;
  readonly name: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'revoked';
}

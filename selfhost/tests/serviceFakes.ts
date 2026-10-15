import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CloudflareApi } from '../service/src/cloudflare.ts';
import type { Context } from '../service/src/context.ts';
import type { Database, Statement } from '../service/src/db.ts';
import type { DiscordApi, DiscordUser } from '../service/src/discord.ts';

/** D1's shape over Node's SQLite, with the service's own migration applied: the same SQL on the same engine. */
export function sqliteDatabase(): Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path.join(import.meta.dirname, '..', 'service', 'migrations', '0001_init.sql'), 'utf8'));
  return {
    prepare(sql: string): Statement {
      const make = (values: (string | number | null)[]): Statement => ({
        bind: (...more) => make([...values, ...more]),
        first: async <T>() => (db.prepare(sql).get(...values) as T | undefined) ?? null,
        all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
        run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
      });
      return make([]);
    },
  };
}

/** Cloudflare's API as the tests watch it: every call recorded, and a step that can be made to fail. */
export class FakeCloudflare implements CloudflareApi {
  readonly calls: string[] = [];
  failOn: string | null = null;
  private next = 0;

  private step(call: string): void {
    this.calls.push(call);
    if (this.failOn !== null && call.startsWith(this.failOn)) throw new Error(`fake failure at ${call}`);
  }

  async createTunnel(name: string, host: string): Promise<string> {
    this.step(`createTunnel ${name} ${host}`);
    this.next += 1;
    return `tunnel-${this.next}`;
  }

  async tunnelToken(tunnelId: string): Promise<string> {
    this.step(`tunnelToken ${tunnelId}`);
    return `token-of-${tunnelId}`;
  }

  async deleteTunnel(tunnelId: string): Promise<void> {
    this.step(`deleteTunnel ${tunnelId}`);
  }

  async createRecord(host: string, tunnelId: string): Promise<string> {
    this.step(`createRecord ${host} ${tunnelId}`);
    return `record-for-${tunnelId}`;
  }

  async deleteRecord(recordId: string): Promise<void> {
    this.step(`deleteRecord ${recordId}`);
  }
}

/** Discord as the tests drive it: a code names the user who "approved" in the browser. */
export class FakeDiscord implements DiscordApi {
  readonly users = new Map<string, DiscordUser>();
  readonly notices: string[] = [];

  authorizeUrl(state: string): string {
    return `https://discord.test/authorize?state=${state}`;
  }

  async user(code: string): Promise<DiscordUser> {
    const user = this.users.get(code);
    if (user === undefined) throw new Error('unknown code');
    return user;
  }

  async notify(text: string): Promise<void> {
    this.notices.push(text);
  }
}

export interface TestService {
  readonly context: Context;
  readonly cloudflare: FakeCloudflare;
  readonly discord: FakeDiscord;
  clock: number;
}

export function testService(adminId = 'admin-id'): TestService {
  const service: TestService = {
    cloudflare: new FakeCloudflare(),
    discord: new FakeDiscord(),
    clock: Date.UTC(2026, 9, 15),
    context: undefined as unknown as Context,
  };
  Object.assign(service, {
    context: {
      db: sqliteDatabase(),
      cloudflare: service.cloudflare,
      discord: service.discord,
      now: () => service.clock,
      publicOrigin: 'https://campaigns.kunlab.cc',
      campaignDomain: 'kunlab.cc',
      adminId,
    } satisfies Context,
  });
  return service;
}

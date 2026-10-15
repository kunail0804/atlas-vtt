import { describe, expect, it } from 'vitest';
import { handle } from '../service/src/app.ts';
import { testService, type TestService } from './serviceFakes.ts';

const ORIGIN = 'https://campaigns.kunlab.cc';

async function call(service: TestService, method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: Record<string, unknown>; location: string | null; headers: Headers }> {
  const headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.7' };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await handle(service.context, new Request(`${ORIGIN}${path}`, { method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }));
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { html: text };
  }
  return { status: response.status, body, location: response.headers.get('location'), headers: response.headers };
}

/** The whole launcher sign-in: code, login link to Discord, back with a Discord code, poll. */
async function signIn(service: TestService, discordId: string, handle: string): Promise<string> {
  service.discord.users.set(`code-${discordId}`, { id: discordId, handle, name: handle.toUpperCase() });
  const started = await call(service, 'POST', '/auth/device');
  const pending = await call(service, 'POST', '/auth/device/token', { body: { device_code: started.body.device_code } });
  expect(pending.body.error).toBe('pending');
  const confirm = await call(service, 'GET', `/login?code=${String(started.body.user_code)}`);
  expect(confirm.status).toBe(200);
  const login = await call(service, 'GET', `/login/discord?code=${String(started.body.user_code)}`);
  expect(login.status).toBe(302);
  const state = new URL(login.location ?? '').searchParams.get('state') ?? '';
  const back = await call(service, 'GET', `/auth/discord/callback?code=code-${discordId}&state=${state}`);
  expect(back.status).toBe(200);
  const polled = await call(service, 'POST', '/auth/device/token', { body: { device_code: started.body.device_code } });
  expect(polled.status).toBe(200);
  return String(polled.body.session_token);
}

describe('the accounts and campaigns service', () => {
  it('signs a GM in through Discord, holds them pending, and tells the administrator', async () => {
    const service = testService();
    const token = await signIn(service, 'paul-id', 'paul');
    expect((await call(service, 'GET', '/me', { token })).body).toEqual({ handle: 'paul', name: 'PAUL', status: 'pending', admin: false });
    expect(service.discord.notices).toHaveLength(1);
    expect(service.discord.notices[0]).toContain('atlas admin approve paul');
    expect(service.limited.length).toBeGreaterThanOrEqual(3);
    const refused = await call(service, 'POST', '/campaigns', { token, body: { name: 'name2' } });
    expect(refused.status).toBe(403);
    expect(service.cloudflare.calls).toEqual([]);
  });

  it('approves the administrator at once, without a notice', async () => {
    const service = testService('admin-id');
    const token = await signIn(service, 'admin-id', 'kunail');
    expect((await call(service, 'GET', '/me', { token })).body).toMatchObject({ status: 'approved', admin: true });
    expect(service.discord.notices).toEqual([]);
  });

  it('creates a campaign once approved, refuses the name to another GM, and starts it for its owner only', async () => {
    const service = testService();
    const admin = await signIn(service, 'admin-id', 'kunail');
    const paul = await signIn(service, 'paul-id', 'paul');
    const lea = await signIn(service, 'lea-id', 'lea');
    expect((await call(service, 'GET', '/admin/accounts?status=pending', { token: admin })).body.accounts).toHaveLength(2);
    expect((await call(service, 'POST', '/admin/accounts/paul/approve', { token: admin })).status).toBe(200);
    expect((await call(service, 'POST', '/admin/accounts/lea/approve', { token: paul })).status).toBe(403);
    await call(service, 'POST', '/admin/accounts/lea/approve', { token: admin });

    const created = await call(service, 'POST', '/campaigns', { token: paul, body: { name: 'name2' } });
    expect(created).toMatchObject({ status: 201, body: { name: 'name2', origin: 'https://name2-vtt.kunlab.cc' } });
    expect(service.cloudflare.calls).toEqual(['createTunnel atlas-campaign-name2 name2-vtt.kunlab.cc', 'createRecord name2-vtt.kunlab.cc tunnel-1']);

    expect((await call(service, 'POST', '/campaigns', { token: lea, body: { name: 'name2' } })).body.error).toBe('taken');
    expect((await call(service, 'GET', '/campaigns/name2/start', { token: paul })).body).toMatchObject({ tunnelToken: 'token-of-tunnel-1', origin: 'https://name2-vtt.kunlab.cc' });
    expect((await call(service, 'GET', '/campaigns/name2/start', { token: lea })).status).toBe(404);
    expect((await call(service, 'GET', '/campaigns', { token: paul })).body.campaigns).toHaveLength(1);
  });

  it('refuses bad names and a sixth campaign', async () => {
    const service = testService();
    const admin = await signIn(service, 'admin-id', 'kunail');
    for (const name of ['', '-a', 'a-', 'A', 'a_b', 'x'.repeat(31)]) {
      expect((await call(service, 'POST', '/campaigns', { token: admin, body: { name } })).body.error).toBe('bad-name');
    }
    for (let index = 1; index <= 5; index += 1) expect((await call(service, 'POST', '/campaigns', { token: admin, body: { name: `c${index}` } })).status).toBe(201);
    expect((await call(service, 'POST', '/campaigns', { token: admin, body: { name: 'c6' } })).body.error).toBe('too-many');
  });

  it('takes a half-made campaign back when Cloudflare fails, and frees its name', async () => {
    const service = testService();
    const admin = await signIn(service, 'admin-id', 'kunail');
    service.cloudflare.failOn = 'createRecord';
    expect((await call(service, 'POST', '/campaigns', { token: admin, body: { name: 'name2' } })).status).toBe(502);
    expect(service.cloudflare.calls).toContain('deleteTunnel tunnel-1');
    service.cloudflare.failOn = null;
    expect((await call(service, 'POST', '/campaigns', { token: admin, body: { name: 'name2' } })).status).toBe(201);
  });

  it('deletes a campaign address first, then its tunnel', async () => {
    const service = testService();
    const admin = await signIn(service, 'admin-id', 'kunail');
    await call(service, 'POST', '/campaigns', { token: admin, body: { name: 'name2' } });
    service.cloudflare.calls.length = 0;
    expect((await call(service, 'DELETE', '/campaigns/name2', { token: admin })).status).toBe(200);
    expect(service.cloudflare.calls).toEqual(['deleteRecord record-for-tunnel-1', 'deleteTunnel tunnel-1']);
    expect((await call(service, 'GET', '/campaigns', { token: admin })).body.campaigns).toEqual([]);
  });

  it('revokes an account: its campaigns go, and its sessions end', async () => {
    const service = testService();
    const admin = await signIn(service, 'admin-id', 'kunail');
    const paul = await signIn(service, 'paul-id', 'paul');
    await call(service, 'POST', '/admin/accounts/paul/approve', { token: admin });
    await call(service, 'POST', '/campaigns', { token: paul, body: { name: 'name2' } });
    await call(service, 'POST', '/admin/accounts/paul/revoke', { token: admin });
    expect(service.cloudflare.calls).toContain('deleteTunnel tunnel-1');
    expect((await call(service, 'GET', '/me', { token: paul })).status).toBe(401);
  });

  it('ends a session after 30 days without use, and keeps one that is used', async () => {
    const service = testService();
    const token = await signIn(service, 'paul-id', 'paul');
    const day = 24 * 60 * 60_000;
    service.clock += 20 * day;
    expect((await call(service, 'GET', '/me', { token })).status).toBe(200);
    service.clock += 20 * day;
    expect((await call(service, 'GET', '/me', { token })).status).toBe(200);
    service.clock += 31 * day;
    expect((await call(service, 'GET', '/me', { token })).status).toBe(401);
  });

  it('shows the launcher\'s code before Discord, and never goes on by itself', async () => {
    const service = testService();
    const started = await call(service, 'POST', '/auth/device');
    const confirm = await call(service, 'GET', `/login?code=${String(started.body.user_code)}`);
    expect(confirm.status).toBe(200);
    expect(confirm.location).toBeNull();
    expect(String(confirm.body.html)).toContain(String(started.body.user_code));
    expect(String(confirm.body.html)).toContain('/login/discord?code=');
    expect(confirm.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(confirm.headers.get('x-frame-options')).toBe('DENY');
  });

  it('refuses logins past the rate limit, keyed by the visitor\'s address', async () => {
    const service = testService();
    service.allowLogins = false;
    expect((await call(service, 'POST', '/auth/device')).status).toBe(429);
    expect(service.limited).toEqual(['203.0.113.7']);
  });

  it('caps pending logins per address and in all, whatever the rate limit lets through', async () => {
    const service = testService();
    const from = async (ip: string): Promise<number> => (await handle(service.context, new Request(`${ORIGIN}/auth/device`, { method: 'POST', headers: { 'cf-connecting-ip': ip } }))).status;
    for (let index = 0; index < 5; index += 1) expect(await from('203.0.113.50')).toBe(200);
    expect(await from('203.0.113.50')).toBe(429);
    for (let index = 0; index < 45; index += 1) expect(await from(`198.51.100.${index}`)).toBe(200);
    expect(await from('192.0.2.1')).toBe(429);
    service.clock += 11 * 60_000;
    expect(await from('203.0.113.50')).toBe(200);
  });

  it('writes a chosen name as plain text in the administrator\'s notice', async () => {
    const service = testService();
    service.discord.users.set('code-x', { id: 'x-id', handle: 'eve_1', name: '**[click](https://evil.test)**' });
    const started = await call(service, 'POST', '/auth/device');
    const login = await call(service, 'GET', `/login/discord?code=${String(started.body.user_code)}`);
    const state = new URL(login.location ?? '').searchParams.get('state') ?? '';
    await call(service, 'GET', `/auth/discord/callback?code=code-x&state=${state}`);
    expect(service.discord.notices[0]).toContain('\\*\\*\\[click\\]\\(https://evil.test\\)\\*\\*');
    expect(service.discord.notices[0]).toContain('eve\\_1');
  });

  it('refuses a login link that expired', async () => {
    const service = testService();
    const started = await call(service, 'POST', '/auth/device');
    service.clock += 11 * 60_000;
    expect((await call(service, 'GET', `/login?code=${String(started.body.user_code)}`)).status).toBe(400);
    expect((await call(service, 'POST', '/auth/device/token', { body: { device_code: started.body.device_code } })).body.error).toBe('expired');
  });
});

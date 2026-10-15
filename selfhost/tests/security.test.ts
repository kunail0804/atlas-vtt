import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CLOSE } from '../../src/app/online/protocol/relay.ts';
import { MAX_SOCKETS_PER_SOURCE } from '../relay/relay.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

/** A raw HTTP request: unlike fetch, it sends the Host header it is given. */
function raw(port: number, method: string, path: string, host: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers: { host } }, (response) => {
      response.resume();
      resolve({ status: response.statusCode ?? 0, headers: response.headers });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** A raw socket with chosen headers: what a browser page or a visitor through the tunnel would send. */
function open(url: string, headers: Record<string, string>): Promise<{ socket: WebSocket; status: number | null }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers });
    socket.on('open', () => resolve({ socket, status: null }));
    socket.on('unexpected-response', (_request, response) => resolve({ socket, status: response.statusCode ?? 0 }));
    socket.on('error', () => undefined);
  });
}

describe('the relay against what the internet and web pages may try', () => {
  let test: TestRelay;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await stopTestRelay(test);
  });

  it('answers the GM side only when addressed to loopback (DNS rebinding)', async () => {
    test = await startTestRelay();
    const rebound = await raw(test.relay.gmPort, 'POST', '/auth/device/token', 'evil.test');
    expect(rebound.status).toBe(421);
    const direct = await raw(test.relay.gmPort, 'POST', '/auth/device/token', `127.0.0.1:${test.relay.gmPort}`);
    expect(direct.status).toBe(200);
  });

  it('refuses a GM socket a web page opens, and takes one without an origin', async () => {
    test = await startTestRelay();
    const created = await createTable(test.gmOrigin);
    const url = `${test.gmOrigin.replace('http', 'ws')}/api/tables/${created.code}/socket`;
    const fromPage = await open(url, { origin: 'https://evil.test' });
    expect(fromPage.status).toBe(403);
    const rebound = await open(url, { host: 'evil.test' });
    expect(rebound.status).toBe(403);
    const gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'plugin GM still connects');
    gm.connection.stop();
  });

  it('caps the public sockets one visitor holds', async () => {
    test = await startTestRelay();
    const created = await createTable(test.gmOrigin);
    const url = `${test.publicUrl}/api/tables/${created.code}/socket`;
    for (let index = 0; index < MAX_SOCKETS_PER_SOURCE; index += 1) {
      const opened = await open(url, { 'cf-connecting-ip': '198.51.100.9' });
      expect(opened.status).toBeNull();
      sockets.push(opened.socket);
    }
    const over = await open(url, { 'cf-connecting-ip': '198.51.100.9' });
    expect(over.status).toBe(429);
    const other = await open(url, { 'cf-connecting-ip': '198.51.100.10' });
    expect(other.status).toBeNull();
    sockets.push(other.socket);
  });

  it('lets one visitor keep at most two newcomers waiting', async () => {
    test = await startTestRelay();
    const created = await createTable(test.gmOrigin);
    const url = `${test.publicUrl}/api/tables/${created.code}/socket`;
    const codes: (number | null)[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { socket } = await open(url, { 'cf-connecting-ip': '198.51.100.9' });
      sockets.push(socket);
      const state = { code: null as number | null, waiting: false };
      socket.on('message', (data) => { if (String(data).includes('"waiting"')) state.waiting = true; });
      socket.on('close', (code) => (state.code = code));
      socket.send(JSON.stringify({ v: 1, t: 'hello', role: 'player', name: `Guest ${index}` }));
      await until(() => state.waiting || state.code !== null, 'knock answered');
      codes.push(state.code);
    }
    expect(codes).toEqual([null, null, CLOSE.tooManyKnocks]);
  });

  it('serves the page with a policy that forbids other scripts and framing', async () => {
    test = await startTestRelay();
    const response = await raw(test.relay.publicPort, 'GET', '/', 'name2-vtt.kunlab.cc');
    const policy = String(response.headers['content-security-policy'] ?? '');
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self' wss://name2-vtt.kunlab.cc");
    const injected = await raw(test.relay.publicPort, 'GET', '/', 'x; script-src *');
    expect(String(injected.headers['content-security-policy'] ?? '')).not.toContain('script-src *');
  });
});

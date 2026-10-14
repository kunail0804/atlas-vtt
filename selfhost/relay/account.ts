import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { MAX_PLAYERS } from '../../src/app/online/protocol/relay.ts';
import { GM_PORT, LOOPBACK } from './config.ts';
import { sendJson, sendText } from './respond.ts';

// The plugin signs the GM in with an OAuth device flow against the Atlas account service.
// Here the relay is that service for one person: the GM side listens on loopback only, so
// whoever reaches it is at this machine, and the sign-in is granted without a browser step.

const TOKEN_FILE = path.join(import.meta.dirname, '..', '.local', 'host-token');

/** The GM's token, kept on disk so a relay restart does not sign the plugin out. */
function loadHostToken(): string {
  try {
    const saved = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    // No token yet: one is made below.
  }
  const token = randomBytes(32).toString('base64url');
  mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

const hostToken = loadHostToken();

/** Whether the request carries the GM's token in its `Authorization` header. */
export function isHost(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${hostToken}`;
}

/** Answers the account routes of the GM side; false when the path is none of them. */
export function handleAccountRequest(request: IncomingMessage, response: ServerResponse, pathname: string): boolean {
  if (request.method === 'POST' && pathname === '/auth/device/code') {
    const accountPage = `http://${LOOPBACK}:${GM_PORT}/account`;
    sendJson(response, 200, { device_code: randomBytes(16).toString('hex'), user_code: 'LOCAL', verification_uri_complete: accountPage, interval: 1, expires_in: 600 });
    return true;
  }
  if (request.method === 'POST' && pathname === '/auth/device/token') {
    sendJson(response, 200, { access_token: hostToken, token_type: 'Bearer' });
    return true;
  }
  if (request.method === 'POST' && pathname === '/auth/sign-out') {
    sendJson(response, 200, {});
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/me') {
    if (!isHost(request)) {
      sendJson(response, 401, { error: 'signed-out' });
      return true;
    }
    const name = userInfo().username;
    sendJson(response, 200, { account: { id: 'local', handle: name, name }, access: { plan: 'Self-hosted', maxPlayers: MAX_PLAYERS, endsAt: null } });
    return true;
  }
  if (request.method === 'GET' && pathname === '/account') {
    sendText(response, 200, '<!doctype html><meta charset="utf-8"><title>Atlas relay</title><p>Signed in to the self-hosted relay. You can close this tab.</p>', 'text/html; charset=utf-8');
    return true;
  }
  return false;
}

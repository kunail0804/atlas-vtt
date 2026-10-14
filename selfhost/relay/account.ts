import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { MAX_PLAYERS } from '../../src/app/online/protocol/relay.ts';
import { sendJson, sendText } from './respond.ts';

// The plugin signs the GM in with an OAuth device flow against the Atlas account service.
// Here the relay is that service for one person: the GM side listens on loopback only, so
// whoever reaches it is at this machine, and the sign-in is granted without a browser step.

/** The GM's token, kept on disk so a relay restart does not sign the plugin out. */
function loadHostToken(dataDir: string): string {
  const file = path.join(dataDir, 'host-token');
  try {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    // No token yet: one is made below.
  }
  const token = randomBytes(32).toString('base64url');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export interface Account {
  /** Whether the request carries the GM's token in its `Authorization` header. */
  isHost(request: IncomingMessage): boolean;
  /** Answers the account routes of the GM side; false when the path is none of them. */
  handle(request: IncomingMessage, response: ServerResponse, pathname: string): boolean;
}

/** `gmOrigin`: where the GM side is reached, for the account page link. `playerOrigin`: the campaign's public address. */
export function createAccount(dataDir: string, gmOrigin: string, playerOrigin: string): Account {
  const hostToken = loadHostToken(dataDir);
  const isHost = (request: IncomingMessage): boolean => request.headers.authorization === `Bearer ${hostToken}`;
  return {
    isHost,
    handle(request, response, pathname) {
      if (request.method === 'POST' && pathname === '/auth/device/code') {
        sendJson(response, 200, { device_code: randomBytes(16).toString('hex'), user_code: 'LOCAL', verification_uri_complete: `${gmOrigin}/account`, interval: 1, expires_in: 600 });
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
        sendJson(response, 200, { account: { id: 'local', handle: name, name }, access: { plan: 'Self-hosted', maxPlayers: MAX_PLAYERS, endsAt: null }, playerOrigin });
        return true;
      }
      if (request.method === 'GET' && pathname === '/account') {
        sendText(response, 200, '<!doctype html><meta charset="utf-8"><title>Atlas relay</title><p>Signed in to the self-hosted relay. You can close this tab.</p>', 'text/html; charset=utf-8');
        return true;
      }
      return false;
    },
  };
}

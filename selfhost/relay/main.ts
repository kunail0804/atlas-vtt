import path from 'node:path';
import { GM_PORT, LOOPBACK, PUBLIC_PORT } from './config.ts';
import { startRelay } from './relay.ts';
import { startTunnel } from './tunnel.ts';

// Settings come from the environment, which the launcher sets for the container.
// Without them the relay runs for development: loopback only, data in selfhost/.local, no idle stop.
const env = process.env;
const idleMinutes = env.IDLE_STOP_MINUTES === undefined ? null : Number(env.IDLE_STOP_MINUTES);
if (idleMinutes !== null && !(Number.isFinite(idleMinutes) && idleMinutes > 0)) {
  console.error(`IDLE_STOP_MINUTES must be a positive number, got: ${env.IDLE_STOP_MINUTES}`);
  process.exit(1);
}

const relay = await startRelay({
  host: env.RELAY_HOST ?? LOOPBACK,
  gmPort: GM_PORT,
  publicPort: PUBLIC_PORT,
  dataDir: env.DATA_DIR ?? path.join(import.meta.dirname, '..', '.local'),
  playerOrigin: env.PLAYER_ORIGIN ?? 'https://vtt.kunlab.cc',
  idleStopMs: idleMinutes === null ? null : idleMinutes * 60_000,
  onIdle: () => {
    console.log(`nobody connected for ${idleMinutes} minutes: stopping`);
    stop(0);
  },
});

// In the container the relay starts the campaign's tunnel itself: one stops, both stop, so an idle
// stop also closes the public address, and a tunnel that dies does not leave a relay nobody reaches.
const tunnelToken = env.TUNNEL_TOKEN;
delete process.env.TUNNEL_TOKEN;
const tunnel = tunnelToken === undefined || tunnelToken === '' ? null : startTunnel(tunnelToken, (code) => {
  console.error(`the tunnel stopped (${code ?? 'did not start'}): stopping`);
  stop(1);
});

function stop(code: number): void {
  tunnel?.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
const host = env.RELAY_HOST ?? LOOPBACK;
console.log(`GM side      http://${host}:${relay.gmPort}`);
console.log(`Public side  http://${host}:${relay.publicPort}  (forwarded by the tunnel)`);
console.log(`Campaign     ${env.PLAYER_ORIGIN ?? 'https://vtt.kunlab.cc'}`);

import path from 'node:path';
import { GM_PORT, LOOPBACK, PUBLIC_PORT } from './config.ts';
import { startRelay } from './relay.ts';

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
    process.exit(0);
  },
});
console.log(`GM side      http://127.0.0.1:${relay.gmPort}  (loopback only)`);
console.log(`Public side  http://127.0.0.1:${relay.publicPort}  (forwarded by the tunnel)`);

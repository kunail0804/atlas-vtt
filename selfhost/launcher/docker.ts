import { UserError, log, run } from './system.ts';

export const IMAGE = 'kunail0804/atlas-relay:latest';
const PREFIX = 'atlas-campaign-';
const DOWNLOAD = Deno.build.os === 'windows' ? 'https://docs.docker.com/desktop/setup/install/windows-install/' : 'https://docs.docker.com/engine/install/';

/** Docker answers: installed, and its engine running. Each failure says what to do. */
export async function checkDocker(): Promise<void> {
  const version = await run('docker', ['--version']);
  if (version.code === -1) throw new UserError(`Docker n'est pas installé. Installe-le depuis ${DOWNLOAD}, puis relance Atlas.`);
  const engine = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (engine.code !== 0) {
    await log(`docker info: ${engine.stderr.slice(0, 300)}`);
    throw new UserError(Deno.build.os === 'windows'
      ? 'Docker Desktop n\'est pas démarré. Ouvre Docker Desktop, attends qu\'il indique « Engine running », puis réessaie.'
      : 'Le service Docker ne répond pas. Démarre-le (sudo systemctl start docker), puis réessaie.');
  }
}

/** Fetches the newest image; without internet, an image already here is used. */
export async function pullImage(): Promise<void> {
  const pulled = await run('docker', ['pull', '--quiet', IMAGE]);
  if (pulled.code === 0) return;
  await log(`docker pull: ${pulled.stderr.slice(0, 300)}`);
  const present = await run('docker', ['image', 'inspect', IMAGE]);
  if (present.code !== 0) throw new UserError('Impossible de télécharger l\'image Atlas. Vérifie ta connexion internet.');
}

/** The plugin build inside the image, copied to `target`: the version the relay that will run expects. */
export async function extractPlugin(target: string): Promise<void> {
  const name = `atlas-plugin-copy-${Date.now()}`;
  const created = await run('docker', ['create', '--name', name, IMAGE]);
  if (created.code !== 0) throw new UserError('Impossible de préparer le plugin depuis l\'image Atlas.');
  try {
    const copied = await run('docker', ['cp', `${name}:/opt/atlas/plugin/.`, target]);
    if (copied.code !== 0) throw new UserError('Impossible de copier le plugin depuis l\'image Atlas.');
  } finally {
    await run('docker', ['rm', '-f', name]);
  }
}

/** The campaign running on this machine now, or null. The plugin talks to one relay at a time (port 8787). */
export async function runningCampaign(): Promise<string | null> {
  const listed = await run('docker', ['ps', '--filter', `name=^${PREFIX}`, '--format', '{{.Names}}']);
  const first = listed.stdout.split('\n').map((line) => line.trim()).find((line) => line.startsWith(PREFIX));
  return first === undefined ? null : first.slice(PREFIX.length);
}

/** Whether something else on this machine holds the GM side's port. */
export async function portTaken(): Promise<boolean> {
  try {
    const listener = Deno.listen({ hostname: '127.0.0.1', port: 8787 });
    listener.close();
    return false;
  } catch {
    return true;
  }
}

/**
 * Starts a campaign: the GM side on this machine's loopback only, the tables in the campaign's own
 * volume, the tunnel token passed by name (`-e TUNNEL_TOKEN`), so it never stands in Docker's arguments.
 */
export async function startCampaign(name: string, origin: string, tunnelToken: string): Promise<void> {
  const env = { ...Deno.env.toObject(), TUNNEL_TOKEN: tunnelToken };
  const started = await run('docker', [
    'run', '-d', '--rm', '--init', '--name', `${PREFIX}${name}`,
    '-p', '127.0.0.1:8787:8787', '-v', `atlas-${name}:/data`,
    '-e', `PLAYER_ORIGIN=${origin}`, '-e', 'TUNNEL_TOKEN', IMAGE,
  ], { env });
  if (started.code !== 0) {
    await log(`docker run: ${started.stderr.slice(0, 500)}`);
    throw new UserError('La campagne n\'a pas pu démarrer. Le détail est dans le journal Atlas.');
  }
}

/** Waits for the relay to answer on this machine, and checks the container is still there. */
export async function waitForRelay(name: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      // Each try is short: while the container starts, Docker's port forwarder may take the
      // connection and never answer, and a fetch without a limit would wait forever.
      const response = await fetch('http://127.0.0.1:8787/api/me', { signal: AbortSignal.timeout(2_000) });
      await response.body?.cancel();
      // The tunnel connects after the relay answers; one Cloudflare refuses stops the container within seconds.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      if ((await runningCampaign()) === name) return;
      break;
    } catch {
      if ((await runningCampaign()) !== name) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const logs = await run('docker', ['logs', `${PREFIX}${name}`]);
  await log(`relay did not answer: ${logs.stdout.slice(-500)} ${logs.stderr.slice(-500)}`);
  throw new UserError('La campagne s\'est arrêtée au démarrage. Le détail est dans le journal Atlas.');
}

export async function stopCampaign(name: string): Promise<void> {
  await run('docker', ['stop', `${PREFIX}${name}`]);
}

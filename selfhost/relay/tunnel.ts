import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Starts `cloudflared` for the campaign's tunnel. The token goes through its environment
 * (`TUNNEL_TOKEN`), never its arguments, so it does not show in the process list. The tunnel's
 * route (the campaign's address to http://localhost:8788) is set on Cloudflare's side when the
 * campaign is created; this only connects it.
 */
export function startTunnel(token: string, exited: (code: number | null) => void): ChildProcess {
  const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', 'run'], {
    env: { ...process.env, TUNNEL_TOKEN: token },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  tunnel.on('exit', (code) => exited(code));
  tunnel.on('error', (error) => {
    console.error(`cloudflared could not start: ${error.message}`);
    exited(null);
  });
  return tunnel;
}

/** Every relay listener binds to loopback: nothing is reachable from the network directly. */
export const LOOPBACK = '127.0.0.1';

/** GM side: the plugin's `RELAY_ORIGIN` and `ACCOUNTS_ORIGIN`. Never exposed by the tunnel. */
export const GM_PORT = 8787;

/** Public side: the player page and the players' sockets. The only port the Cloudflare Tunnel forwards. */
export const PUBLIC_PORT = 8788;

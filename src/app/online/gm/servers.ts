// Self-hosted fork: the relay runs on the GM's own machine (see selfhost/README.md).
// The GM's side talks to it over loopback, which never leaves the machine; players reach
// the public side through a Cloudflare Tunnel, at the address the relay names (`playerOrigin`).

export { ACCOUNT_PAGE_URL, ACCOUNTS_ORIGIN } from '../../account/accountServers';

/** The self-hosted relay's GM side, on loopback: where tables are asked for and the GM's socket connects. */
export const RELAY_ORIGIN = 'http://127.0.0.1:8787';

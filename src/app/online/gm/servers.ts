// Self-hosted fork: the relay runs on the GM's own machine (see selfhost/README.md).
// The GM's side talks to it over loopback, which never leaves the machine; players reach
// the public side through a Cloudflare Tunnel.

/** The self-hosted relay's GM side, on loopback: where tables are asked for and the GM's socket connects. */
export const RELAY_ORIGIN = 'http://127.0.0.1:8787';

/** The relay's public side: what a join link names, the page players open. */
export const PLAYER_ORIGIN = 'https://vtt.kunlab.cc';

/** The account service: the self-hosted relay answers the GM's sign-in itself, on loopback. */
export const ACCOUNTS_ORIGIN = 'http://127.0.0.1:8787';

/** The account page: the relay's own page on loopback. */
export const ACCOUNT_PAGE_URL = 'http://127.0.0.1:8787/account';

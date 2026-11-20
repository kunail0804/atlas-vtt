// Self-hosted fork: the GM's account is the self-hosted relay's, which answers the sign-in itself on loopback.

/** The account service: the self-hosted relay, on loopback. The only origin the account token goes to besides the table server. */
export const ACCOUNTS_ORIGIN = 'http://127.0.0.1:8787';

/** The account page: the relay's own page on loopback. */
export const ACCOUNT_PAGE_URL = 'http://127.0.0.1:8787/account';

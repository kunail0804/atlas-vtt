/** A Discord user as the service keeps them: the stable id, the unique handle, and the shown name. */
export interface DiscordUser {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
}

/** What the service asks of Discord. The tests stand in for it. */
export interface DiscordApi {
  /** The URL that sends the browser to Discord's consent page (permission `identify` only). */
  authorizeUrl(state: string): string;
  /** Trades the code Discord sent back for the user who approved. */
  user(code: string): Promise<DiscordUser>;
  /** Posts to the administrator's channel; failures are only logged. */
  notify(text: string): Promise<void>;
}

const DISCORD = 'https://discord.com';

export function discordApi(clientId: string, clientSecret: string, redirectUri: string, webhookUrl: string, fetcher: typeof fetch = fetch): DiscordApi {
  return {
    authorizeUrl(state) {
      const query = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'identify', state, redirect_uri: redirectUri });
      return `${DISCORD}/oauth2/authorize?${query.toString()}`;
    },
    async user(code) {
      const tokenResponse = await fetcher(`${DISCORD}/api/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }).toString(),
      });
      if (!tokenResponse.ok) throw new Error(`Discord refused the code: ${tokenResponse.status}`);
      const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };
      const meResponse = await fetcher(`${DISCORD}/api/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!meResponse.ok) throw new Error(`Discord did not say who signed in: ${meResponse.status}`);
      const me = (await meResponse.json()) as { id: string; username: string; global_name?: string | null };
      return { id: me.id, handle: me.username, name: me.global_name ?? me.username };
    },
    async notify(text) {
      // No mention is ever resolved: a name someone picked must not ping anyone.
      const response = await fetcher(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
      });
      if (!response.ok) console.error(`Discord webhook failed: ${response.status}`);
    },
  };
}

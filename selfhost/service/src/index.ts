import { handle } from './app.ts';
import { cloudflareApi } from './cloudflare.ts';
import type { Env } from './config.ts';
import { discordApi } from './discord.ts';
import { failure } from './http.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const context = {
      db: env.DB,
      cloudflare: cloudflareApi(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_ZONE_ID),
      discord: discordApi(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET, `${env.PUBLIC_ORIGIN}/auth/discord/callback`, env.DISCORD_WEBHOOK_URL),
      now: () => Date.now(),
      publicOrigin: env.PUBLIC_ORIGIN,
      campaignDomain: env.CAMPAIGN_DOMAIN,
      adminId: env.ADMIN_DISCORD_ID,
      allow: async (_bucket: 'login', key: string) => (await env.LOGIN_LIMIT.limit({ key })).success,
    };
    try {
      return await handle(context, request);
    } catch (error) {
      console.error(String(error));
      return failure(500, 'internal', 'Le service a rencontré une erreur. Réessaie dans un moment.');
    }
  },
};

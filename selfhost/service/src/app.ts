import { decide, isAdmin, listAccounts } from './admin.ts';
import { finishLogin, goToDiscord, logout, me, openLogin, pollDeviceLogin, sessionAccount, startDeviceLogin } from './auth.ts';
import { createCampaign, deleteCampaign, listCampaigns, startCampaign } from './campaigns.ts';
import type { Context } from './context.ts';
import { failure } from './http.ts';

const CAMPAIGN_PATH = /^\/campaigns\/([^/]+)(\/start)?$/;
const ADMIN_PATH = /^\/admin\/accounts\/([^/]+)\/([a-z]+)$/;

/** Every route of the service. Errors the GM can act on carry a French `message`. */
export async function handle(context: Context, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (method === 'POST' && pathname === '/auth/device') return startDeviceLogin(context, request);
  if (method === 'GET' && pathname === '/login') return openLogin(context, url);
  if (method === 'GET' && pathname === '/login/discord') return goToDiscord(context, request, url);
  if (method === 'GET' && pathname === '/auth/discord/callback') return finishLogin(context, request, url);
  if (method === 'POST' && pathname === '/auth/device/token') return pollDeviceLogin(context, request);

  const session = await sessionAccount(context, request);
  if (session === null) return failure(401, 'signed-out', 'Connecte-toi d\'abord : atlas login');
  const { account } = session;

  if (method === 'POST' && pathname === '/auth/logout') return logout(context, session.tokenHash);
  if (method === 'GET' && pathname === '/me') return me(context, account);
  if (pathname === '/campaigns') {
    if (method === 'GET') return listCampaigns(context, account);
    if (method === 'POST') return createCampaign(context, account, request);
  }
  const campaign = CAMPAIGN_PATH.exec(pathname);
  if (campaign !== null) {
    const name = decodeURIComponent(campaign[1] ?? '');
    if (method === 'GET' && campaign[2] === '/start') return startCampaign(context, account, name);
    if (method === 'DELETE' && campaign[2] === undefined) return deleteCampaign(context, account, name);
  }
  if (pathname.startsWith('/admin/')) {
    if (!isAdmin(context, account)) return failure(403, 'not-admin', 'Réservé à l\'administrateur.');
    if (method === 'GET' && pathname === '/admin/accounts') return listAccounts(context, url.searchParams.get('status'));
    const decision = ADMIN_PATH.exec(pathname);
    if (method === 'POST' && decision !== null) return decide(context, decodeURIComponent(decision[1] ?? ''), decision[2] ?? '');
  }
  return failure(404, 'not-found', 'Route inconnue.');
}

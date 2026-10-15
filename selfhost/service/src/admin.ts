import { campaignsOf, removeCampaign } from './campaigns.ts';
import type { Account, Context } from './context.ts';
import { failure, json } from './http.ts';

const ACTIONS = ['approve', 'reject', 'revoke'] as const;
type Action = (typeof ACTIONS)[number];

export const isAdmin = (context: Context, account: Account): boolean => account.discord_id === context.adminId;

export async function listAccounts(context: Context, status: string | null): Promise<Response> {
  const statement = status === null
    ? context.db.prepare('SELECT * FROM accounts ORDER BY created_at')
    : context.db.prepare('SELECT * FROM accounts WHERE status = ? ORDER BY created_at').bind(status);
  const { results } = await statement.all<Account & { created_at: number }>();
  const accounts = [];
  for (const account of results) {
    const campaigns = (await campaignsOf(context, account.discord_id)).map((row) => row.name);
    accounts.push({ handle: account.handle, name: account.name, status: account.status, createdAt: account.created_at, campaigns });
  }
  return json(200, { accounts });
}

/** approve, reject or revoke an account by its Discord handle. Revoking also takes its campaigns and sessions away. */
export async function decide(context: Context, handle: string, action: string): Promise<Response> {
  if (!(ACTIONS as readonly string[]).includes(action)) return failure(404, 'not-found', 'Action inconnue.');
  const account = await context.db.prepare('SELECT * FROM accounts WHERE handle = ?').bind(handle).first<Account>();
  if (account === null) return failure(404, 'unknown', `Aucun compte « ${handle} ».`);
  if (account.discord_id === context.adminId) return failure(400, 'self', 'Ton propre compte reste administrateur.');
  const status: Record<Action, Account['status']> = { approve: 'approved', reject: 'rejected', revoke: 'revoked' };
  await context.db.prepare('UPDATE accounts SET status = ?, decided_at = ? WHERE discord_id = ?').bind(status[action as Action], context.now(), account.discord_id).run();
  if (action === 'revoke') {
    for (const row of await campaignsOf(context, account.discord_id)) await removeCampaign(context, row);
    await context.db.prepare('DELETE FROM sessions WHERE discord_id = ?').bind(account.discord_id).run();
  }
  return json(200, { handle, status: status[action as Action] });
}

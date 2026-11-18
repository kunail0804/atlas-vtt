import { STATUS_TEXT } from './commands.ts';
import { api } from './service.ts';

interface AdminAccount {
  readonly handle: string;
  readonly name: string;
  readonly status: string;
  readonly campaigns: readonly string[];
}

async function accounts(onlyPending: boolean): Promise<AdminAccount[]> {
  return (await api<{ accounts: AdminAccount[] }>('GET', `/admin/accounts${onlyPending ? '?status=pending' : ''}`)).accounts;
}

/** How many accounts wait for the administrator; null when the service does not answer. */
export async function pendingCount(): Promise<number | null> {
  return (await accounts(true).catch(() => null))?.length ?? null;
}

export async function adminList(onlyPending: boolean): Promise<void> {
  const listed = await accounts(onlyPending);
  if (listed.length === 0) return console.log(onlyPending ? 'Aucun compte en attente.' : 'Aucun compte.');
  for (const account of listed) console.log(`  ${account.handle}  ${account.name}  ${STATUS_TEXT[account.status] ?? account.status}  ${account.campaigns.join(', ')}`);
}

export async function adminDecide(action: 'approve' | 'reject' | 'revoke', handle: string): Promise<void> {
  const decided = await api<{ handle: string; status: string }>('POST', `/admin/accounts/${encodeURIComponent(handle)}/${action}`);
  console.log(`${decided.handle} : ${STATUS_TEXT[decided.status] ?? decided.status}.`);
}

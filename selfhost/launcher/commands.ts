import { checkDocker, portTaken, pullImage, runningCampaign, startCampaign, stopCampaign, waitForRelay } from './docker.ts';
import { login } from './login.ts';
import { api, forgetSession, me, sessionToken } from './service.ts';
import { UserError, ask, copyToClipboard } from './system.ts';
import { campaignVault, installPlugins } from './vault.ts';

interface Campaign {
  readonly name: string;
  readonly origin: string;
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'en attente de validation par l\'administrateur',
  approved: 'validé',
  rejected: 'refusé',
  revoked: 'révoqué',
};

export async function signIn(): Promise<void> {
  await login();
  const account = await me();
  console.log(`\nConnecté en tant que ${account.name} (${account.handle}). Compte ${STATUS_TEXT[account.status] ?? account.status}.`);
  if (account.status === 'pending') console.log('L\'administrateur a été prévenu. Tu pourras créer des campagnes dès qu\'il aura validé ton compte.');
}

export async function signOut(): Promise<void> {
  if ((await sessionToken()) !== null) await api('POST', '/auth/logout').catch(() => undefined);
  await forgetSession();
  console.log('Déconnecté.');
}

export async function status(): Promise<void> {
  if ((await sessionToken()) === null) {
    console.log('Pas connecté.');
  } else {
    const account = await me();
    console.log(`Connecté : ${account.name} (${account.handle}), compte ${STATUS_TEXT[account.status] ?? account.status}${account.admin ? ', administrateur' : ''}.`);
  }
  const running = await runningCampaign().catch(() => null);
  console.log(running === null ? 'Aucune campagne en cours sur cette machine.' : `Campagne en cours : ${running}.`);
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { campaigns } = await api<{ campaigns: Campaign[] }>('GET', '/campaigns');
  return campaigns;
}

export async function printCampaigns(): Promise<void> {
  const campaigns = await listCampaigns();
  if (campaigns.length === 0) return console.log('Aucune campagne. Crée-en une avec « Créer une campagne ».');
  for (const campaign of campaigns) console.log(`  ${campaign.name}  ${campaign.origin}`);
}

export async function createCampaign(name: string): Promise<void> {
  const created = await api<Campaign>('POST', '/campaigns', { name });
  console.log(`Campagne créée : ${created.origin}`);
}

export async function deleteCampaign(name: string): Promise<void> {
  if ((await runningCampaign()) === name) await stopCampaign(name);
  await api('DELETE', `/campaigns/${encodeURIComponent(name)}`);
  console.log(`Campagne « ${name} » supprimée. Son adresse ne répond plus.`);
}

/**
 * Starts a campaign, after the checks the architecture names: Docker installed and running,
 * signed in, account approved, a vault, the port free. Each stop says what to do.
 */
export async function start(name: string): Promise<void> {
  console.log('Vérification de Docker…');
  await checkDocker();
  const account = await me();
  if (account.status !== 'approved') throw new UserError(`Ton compte est ${STATUS_TEXT[account.status] ?? account.status} : tu ne peux pas encore lancer de campagne.`);
  const running = await runningCampaign();
  if (running !== null) {
    const answer = ask(`La campagne « ${running} » tourne déjà. L'arrêter pour lancer « ${name} » ? (o/n)`).toLowerCase();
    if (answer !== 'o' && answer !== 'oui') throw new UserError('Lancement annulé.');
    await stopCampaign(running);
  } else if (await portTaken()) {
    throw new UserError('Un autre programme utilise déjà le port 8787 de cette machine. Ferme-le, puis réessaie.');
  }
  const vault = await campaignVault(name);
  console.log('Téléchargement de la dernière version d\'Atlas…');
  await pullImage();
  const changes = await installPlugins(vault);
  const campaign = await api<{ origin: string; tunnelToken: string }>('GET', `/campaigns/${encodeURIComponent(name)}/start`);
  console.log('Démarrage de la campagne…');
  await startCampaign(name, campaign.origin, campaign.tunnelToken);
  await waitForRelay(name);
  const copied = await copyToClipboard(campaign.origin);
  console.log(`\nLa campagne « ${name} » tourne.`);
  console.log(`Adresse des joueurs : ${campaign.origin}${copied ? '  (copiée)' : ''}`);
  console.log('Dans Obsidian, ouvre le coffre de la campagne puis « Start online table » : le lien d\'invitation complet s\'affiche là.');
  if (changes.statblocks !== null) console.log(`Fantasy Statblocks ${changes.statblocks} a été installé dans ce coffre : Atlas y lit les statblocks.`);
  if (changes.enabled.length > 0) console.log(`Plugins activés dans ce coffre : ${changes.enabled.join(', ')}. Si Obsidian est en mode restreint, active les plugins communautaires dans ses réglages.`);
  if (changes.atlas || changes.statblocks !== null || changes.enabled.length > 0) console.log('Les plugins du coffre ont changé : ferme et rouvre Obsidian s\'il était ouvert.');
  console.log('La campagne s\'arrête toute seule 5 minutes après le départ de tout le monde.');
}

export async function stop(): Promise<void> {
  const running = await runningCampaign();
  if (running === null) return console.log('Aucune campagne en cours.');
  await stopCampaign(running);
  console.log(`Campagne « ${running} » arrêtée.`);
}

interface AdminAccount {
  readonly handle: string;
  readonly name: string;
  readonly status: string;
  readonly campaigns: readonly string[];
}

export async function adminList(onlyPending: boolean): Promise<void> {
  const { accounts } = await api<{ accounts: AdminAccount[] }>('GET', `/admin/accounts${onlyPending ? '?status=pending' : ''}`);
  if (accounts.length === 0) return console.log(onlyPending ? 'Aucun compte en attente.' : 'Aucun compte.');
  for (const account of accounts) console.log(`  ${account.handle}  ${account.name}  ${STATUS_TEXT[account.status] ?? account.status}  ${account.campaigns.join(', ')}`);
}

export async function adminDecide(action: 'approve' | 'reject' | 'revoke', handle: string): Promise<void> {
  const decided = await api<{ handle: string; status: string }>('POST', `/admin/accounts/${encodeURIComponent(handle)}/${action}`);
  console.log(`${decided.handle} : ${STATUS_TEXT[decided.status] ?? decided.status}.`);
}

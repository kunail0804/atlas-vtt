import { checkDocker, portTaken, pullImage, runningCampaign, startCampaign, stopCampaign, waitForRelay } from './docker.ts';
import { ownCampaign } from './campaigns.ts';
import { login } from './login.ts';
import { ServiceError, api, forgetSession, me, sessionToken, type Me } from './service.ts';
import { COMMAND, UserError, ask, isYes } from './system.ts';
import { campaignVault, installPlugins, type VaultChanges } from './vault.ts';
import { imageOf, type Channel } from './channel.ts';

export const STATUS_TEXT: Record<string, string> = {
  pending: 'en attente de validation par l\'administrateur',
  approved: 'validé',
  rejected: 'refusé',
  revoked: 'révoqué',
};

const WAITING = 'L\'administrateur a été prévenu sur Discord à ta première connexion. Tu pourras créer et lancer des campagnes dès qu\'il aura validé ton compte : '
  + `${COMMAND} status te dit où il en est.`;

/** The account this machine is signed in to, or null; a session the service ended is forgotten. */
async function signedIn(): Promise<Me | null> {
  if ((await sessionToken()) === null) return null;
  try {
    return await me();
  } catch (error) {
    if (error instanceof ServiceError && (await sessionToken()) === null) return null;
    throw error;
  }
}

export async function signIn(): Promise<void> {
  const already = await signedIn();
  if (already !== null) {
    console.log(`Tu es déjà connecté en tant que ${already.name} (${already.handle}), compte ${STATUS_TEXT[already.status] ?? already.status}.`);
    return console.log(`Pour changer de compte : ${COMMAND} logout, puis ${COMMAND} login.`);
  }
  await login();
  const account = await me();
  console.log(`\nConnecté en tant que ${account.name} (${account.handle}). Compte ${STATUS_TEXT[account.status] ?? account.status}.`);
  if (account.status === 'pending') console.log(WAITING);
}

export async function signOut(): Promise<void> {
  if ((await sessionToken()) === null) return console.log('Tu n\'étais pas connecté sur cette machine.');
  await api('POST', '/auth/logout').catch(() => undefined);
  await forgetSession();
  console.log('Déconnecté.');
}

export async function status(): Promise<void> {
  const account = await signedIn();
  if (account === null) {
    console.log('Pas connecté.');
  } else {
    console.log(`Connecté : ${account.name} (${account.handle}), compte ${STATUS_TEXT[account.status] ?? account.status}${account.admin ? ', administrateur' : ''}.`);
    if (account.status === 'pending') console.log(WAITING);
  }
  const running = await runningCampaign().catch(() => null);
  console.log(running === null ? 'Aucune campagne en cours sur cette machine.' : `Campagne en cours : ${running}.`);
}

/** An approved account, or the reason there is none. */
async function approvedAccount(): Promise<Me> {
  const account = await signedIn();
  if (account === null) throw new UserError(`Tu n'es pas connecté : choisis « Se connecter » dans le menu, ou tape ${COMMAND} login.`);
  if (account.status === 'pending') throw new UserError(`Ton compte attend encore la validation de l'administrateur : tu ne peux pas encore lancer de campagne. ${WAITING}`);
  if (account.status !== 'approved') throw new UserError(`Ton compte est ${STATUS_TEXT[account.status] ?? account.status} : tu ne peux pas lancer de campagne.`);
  return account;
}

/**
 * Starts a campaign, after the checks the architecture names: signed in, account approved, the
 * campaign the GM's, Docker installed and running, a vault, the port free. Each stop says what to
 * do. The `dev` channel runs the image develop published last, with its plugin.
 */
export async function start(name: string, channel: Channel = 'stable'): Promise<void> {
  const image = imageOf(channel);
  await approvedAccount();
  const campaign = await ownCampaign(name);
  console.log('Vérification de Docker…');
  await checkDocker();
  const running = await runningCampaign();
  if (running === name) {
    console.log(`La campagne « ${name} » tourne déjà (${campaign.origin}).`);
    return console.log(`Pour la relancer : ${COMMAND} stop, puis ${COMMAND} start ${name}.`);
  }
  if (running !== null) {
    if (!isYes(ask(`La campagne « ${running} » tourne déjà. L'arrêter pour lancer « ${name} » ? (o/n)`))) throw new UserError('Lancement annulé.');
    await stopCampaign(running);
  } else if (await portTaken()) {
    throw new UserError('Un autre programme utilise déjà le port 8787 de cette machine. Ferme-le, puis réessaie.');
  }
  const vault = await campaignVault(name);
  console.log(channel === 'dev' ? `Téléchargement de la version de développement d'Atlas (${image})…` : 'Téléchargement de la dernière version d\'Atlas…');
  await pullImage(image);
  const changes = await installPlugins(vault, image);
  const started = await api<{ origin: string; tunnelToken: string }>('GET', `/campaigns/${encodeURIComponent(name)}/start`);
  console.log('Démarrage de la campagne…');
  await startCampaign(name, image, started.origin, started.tunnelToken);
  await waitForRelay(name);
  console.log(startedText(name, vault, started.origin, changes));
}

/** What the GM reads once the campaign runs: what to do next first, then what changed in the vault. */
export function startedText(name: string, vault: string, origin: string, changes: VaultChanges): string {
  const lines = [
    `\nLa campagne « ${name} » tourne, avec le coffre ${vault}.`,
    'Pour inviter les joueurs : dans Obsidian, ouvre ce coffre, lance la table (« Start online table »), puis clique sur « Copy invite link » :',
    'Atlas copie le lien d\'invitation sans l\'afficher. C\'est ce lien que tu envoies aux joueurs.',
    `L'adresse de la campagne, ${origin}, ne suffit pas : sans le lien d'invitation, les joueurs n'y trouvent pas de table.`,
    'Elle s\'arrête toute seule si personne ne s\'y connecte dans l\'heure, puis 5 minutes après le départ de tout le monde.',
  ];
  const plugins: string[] = [];
  if (changes.statblocks !== null) plugins.push(`Fantasy Statblocks ${changes.statblocks} installé (Atlas y lit les statblocks).`);
  if (changes.enabled.length > 0) plugins.push(`Plugins activés dans ce coffre : ${changes.enabled.join(', ')}.`);
  if (changes.atlas || changes.statblocks !== null || changes.enabled.length > 0) plugins.push('Si Obsidian était ouvert sur ce coffre, ferme-le et rouvre-le.');
  if (changes.enabled.length > 0) {
    plugins.push('À la première ouverture, Obsidian demande s\'il faut faire confiance à l\'auteur du coffre : choisis « Faire confiance à l\'auteur et activer les modules ».',
      'Le mode restreint, qu\'Entrée choisit, ne charge pas Atlas.');
  }
  return plugins.length === 0 ? lines.join('\n') : `${lines.join('\n')}\n\n${plugins.join('\n')}`;
}

export async function stop(): Promise<void> {
  const running = await runningCampaign();
  if (running === null) return console.log('Aucune campagne en cours.');
  await stopCampaign(running);
  console.log(`Campagne « ${running} » arrêtée.`);
}

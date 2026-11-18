import { hasTables, runningCampaign, stopCampaign } from './docker.ts';
import { ServiceError, api } from './service.ts';
import { COMMAND, UserError, ask, inputEnded, isYes } from './system.ts';
import { chooseVault, forgetVault, savedVault } from './vault.ts';

export interface Campaign {
  readonly name: string;
  readonly origin: string;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { campaigns } = await api<{ campaigns: Campaign[] }>('GET', '/campaigns');
  return campaigns;
}

/** The GM's campaign of that name; otherwise a message naming the ones there are. */
export async function ownCampaign(name: string): Promise<Campaign> {
  const campaigns = await listCampaigns();
  const found = campaigns.find((campaign) => campaign.name === name);
  if (found !== undefined) return found;
  throw new UserError(campaigns.length === 0
    ? `Tu n'as pas de campagne « ${name} », ni aucune autre. ${CREATE_HINT}`
    : `Tu n'as pas de campagne « ${name} ». Tes campagnes : ${campaigns.map((campaign) => campaign.name).join(', ')}.`);
}

const CREATE_HINT = `Crée-en une : « Créer une campagne » dans le menu, ou ${COMMAND} campaign create <nom>.`;

/** The campaigns as a table: names in one column, addresses in the next. */
export function campaignTable(campaigns: readonly Campaign[]): string {
  const width = Math.max(...campaigns.map((campaign) => campaign.name.length));
  return campaigns.map((campaign) => `  ${campaign.name.padEnd(width)}  ${campaign.origin}`).join('\n');
}

export async function printCampaigns(): Promise<void> {
  const campaigns = await listCampaigns();
  if (campaigns.length === 0) return console.log(`Aucune campagne. ${CREATE_HINT}`);
  console.log(campaignTable(campaigns));
}

/**
 * Creates a campaign. `name` is what the GM typed, spaces and all: the service says which rule a
 * name breaks and proposes one that keeps them, so `campaign create ma campagne` never makes « ma ».
 */
export async function createCampaign(name: string): Promise<void> {
  const created = await api<Campaign>('POST', '/campaigns', { name });
  console.log(`Campagne créée : « ${created.name} », adresse ${created.origin}`);
  console.log(`Pour la lancer : « Lancer une campagne » dans le menu, ou ${COMMAND} start ${created.name}.`);
}

/** The menu's creation: asks again after a name the service refused, until one is taken or none is typed. */
export async function createFromMenu(): Promise<void> {
  for (;;) {
    const name = ask('Nom de la campagne (lettres minuscules, chiffres et tirets, 30 au plus) :');
    if (name === '' || inputEnded()) return console.log('Aucun nom tapé : aucune campagne créée.');
    try {
      return await createCampaign(name);
    } catch (error) {
      if (!(error instanceof ServiceError) || (error.code !== 'bad-name' && error.code !== 'taken')) throw error;
      console.log(error.message);
    }
  }
}

/**
 * Deletes a campaign after the GM confirmed, from the menu and the command line alike. The tables
 * (the Docker volume) are kept: they are the GM's work, and nothing on the service needs them gone.
 */
export async function deleteCampaign(name: string): Promise<void> {
  await ownCampaign(name);
  if (!isYes(ask(`Supprimer « ${name} » et son adresse pour de bon ? (o/n)`))) return console.log('Suppression annulée.');
  if ((await runningCampaign().catch(() => null)) === name) await stopCampaign(name);
  await api('DELETE', `/campaigns/${encodeURIComponent(name)}`);
  await forgetVault(name);
  console.log(`Campagne « ${name} » supprimée. Son adresse ne répond plus.`);
  if (await hasTables(name).catch(() => false)) {
    console.log(`Ses tables restent sur cette machine, dans le volume Docker atlas-${name}. Pour les effacer : docker volume rm atlas-${name}`);
  }
}

/** Chooses the campaign's vault again, for a GM who picked the wrong folder. */
export async function changeVault(name: string): Promise<void> {
  await ownCampaign(name);
  const before = await savedVault(name);
  if (before !== null) console.log(`Coffre actuel : ${before}`);
  const vault = await chooseVault(name);
  console.log(`La campagne « ${name} » utilisera ce coffre au prochain lancement : ${vault}`);
}

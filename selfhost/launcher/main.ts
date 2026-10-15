import { adminDecide, adminList, createCampaign, deleteCampaign, listCampaigns, printCampaigns, signIn, signOut, start, status, stop } from './commands.ts';
import { manual } from './man.ts';
import { logFile } from './paths.ts';
import { me, sessionToken, type Me } from './service.ts';
import { UserError, ask, log, pause } from './system.ts';
import { updateNotice } from './update.ts';
import { VERSION } from './version.ts';

async function account(): Promise<Me | null> {
  if ((await sessionToken()) === null) return null;
  try {
    return await me();
  } catch {
    return null;
  }
}

/** A campaign picked from the GM's list by number. */
async function chooseCampaign(verb: string): Promise<string | null> {
  const campaigns = await listCampaigns();
  if (campaigns.length === 0) {
    console.log('Aucune campagne. Crée-en une d\'abord.');
    return null;
  }
  campaigns.forEach((campaign, index) => console.log(`  ${index + 1}. ${campaign.name}  (${campaign.origin})`));
  const picked = Number(ask(`Quelle campagne ${verb} ? (numéro)`));
  return campaigns[picked - 1]?.name ?? null;
}

async function runCommand(args: string[]): Promise<void> {
  const [command, sub, value] = args;
  const need = (what: string | undefined, usage: string): string => {
    if (what === undefined || what === '') throw new UserError(`Usage : ${usage}`);
    return what;
  };
  switch (command) {
    case 'man': case 'help': case '--help':
      return console.log(manual((await account())?.admin === true));
    case 'version': case '--version':
      return console.log(`atlas ${VERSION}`);
    case 'login': return signIn();
    case 'logout': return signOut();
    case 'status': return status();
    case 'start': return start(need(sub, 'atlas start <nom>'));
    case 'stop': return stop();
    case 'campaign':
      if (sub === 'list') return printCampaigns();
      if (sub === 'create') return createCampaign(need(value, 'atlas campaign create <nom>'));
      if (sub === 'delete') return deleteCampaign(need(value, 'atlas campaign delete <nom>'));
      throw new UserError('Usage : atlas campaign list | create <nom> | delete <nom>');
    case 'admin':
      if (sub === 'pending' || sub === 'list') return adminList(sub === 'pending');
      if (sub === 'approve' || sub === 'reject' || sub === 'revoke') return adminDecide(sub, need(value, `atlas admin ${sub} <pseudo>`));
      throw new UserError('Usage : atlas admin pending | list | approve | reject | revoke <pseudo>');
    default:
      throw new UserError(`Commande inconnue : ${command ?? ''}. Tape « atlas man » pour l'aide.`);
  }
}

async function menuOnce(): Promise<boolean> {
  const who = await account();
  console.log(`\n══════════ ATLAS ${VERSION} ══════════`);
  const notice = await updateNotice();
  if (notice !== null) console.log(`${notice}\n`);
  if (who === null) {
    console.log('Pas connecté.\n  1. Se connecter avec Discord\n  2. Aide\n  0. Quitter');
    const choice = ask('Ton choix :');
    if (choice === '1') await signIn();
    else if (choice === '2') console.log(manual(false));
    return choice !== '0';
  }
  await status();
  const items: [string, () => Promise<void>][] = [
    ['Lancer une campagne', async () => { const name = await chooseCampaign('lancer'); if (name !== null) await start(name); }],
    ['Créer une campagne', async () => { const name = ask('Nom de la campagne (lettres minuscules, chiffres, tirets) :'); if (name !== '') await createCampaign(name); }],
    ['Arrêter la campagne en cours', stop],
    ['Supprimer une campagne', async () => {
      const name = await chooseCampaign('supprimer');
      if (name !== null && ask(`Supprimer « ${name} » et son adresse pour de bon ? (o/n)`).toLowerCase().startsWith('o')) await deleteCampaign(name);
    }],
    ['Mes campagnes', printCampaigns],
    ['Aide', async () => console.log(manual(who.admin))],
    ['Se déconnecter', signOut],
  ];
  if (who.admin) {
    items.push(['Comptes en attente', () => adminList(true)]);
    items.push(['Valider, refuser ou révoquer un compte', async () => {
      const handle = ask('Pseudo Discord du compte :');
      const action = ask('1. Valider  2. Refuser  3. Révoquer :');
      const chosen = ({ '1': 'approve', '2': 'reject', '3': 'revoke' } as const)[action as '1' | '2' | '3'];
      if (handle !== '' && chosen !== undefined) await adminDecide(chosen, handle);
    }]);
  }
  items.forEach(([label], index) => console.log(`  ${index + 1}. ${label}`));
  console.log('  0. Quitter');
  const choice = ask('Ton choix :');
  if (choice === '0') return false;
  await items[Number(choice) - 1]?.[1]();
  return true;
}

async function report(error: unknown): Promise<void> {
  if (error instanceof UserError) {
    console.log(`\n${error.message}`);
    return;
  }
  await log(`unexpected: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  console.log(`\nUne erreur inattendue s'est produite. Envoie ce fichier à l'administrateur : ${logFile()}`);
}

if (Deno.args.length > 0) {
  try {
    await runCommand(Deno.args);
    const notice = await updateNotice();
    if (notice !== null) console.log(`\n${notice}`);
  } catch (error) {
    await report(error);
    Deno.exit(1);
  }
} else {
  // Double-clicked: the window stays until the GM leaves, whatever goes wrong in between.
  let again = true;
  while (again) {
    try {
      again = await menuOnce();
    } catch (error) {
      await report(error);
    }
    if (again) pause();
  }
}

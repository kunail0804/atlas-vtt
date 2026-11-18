import { adminDecide, adminList, pendingCount } from './admin.ts';
import { changeVault, createCampaign, createFromMenu, deleteCampaign, listCampaigns, printCampaigns } from './campaigns.ts';
import { signIn, signOut, start, status, stop } from './commands.ts';
import { startArguments } from './channel.ts';
import { manual } from './man.ts';
import { logFile } from './paths.ts';
import { me, sessionToken, type Me } from './service.ts';
import { COMMAND, UserError, ask, inputEnded, log, pause } from './system.ts';
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

/** A campaign picked from the GM's list by number; null, said why, for no campaign or another answer. */
async function chooseCampaign(verb: string): Promise<string | null> {
  const campaigns = await listCampaigns();
  if (campaigns.length === 0) {
    console.log('Aucune campagne. Crée-en une d\'abord (« Créer une campagne »).');
    return null;
  }
  campaigns.forEach((campaign, index) => console.log(`  ${index + 1}. ${campaign.name}  (${campaign.origin})`));
  const answer = ask(`Quelle campagne ${verb} ? (numéro)`);
  const picked = campaigns[Number(answer) - 1];
  if (picked === undefined && answer !== '' && !inputEnded()) console.log(`Pas de campagne n° ${answer} : tape un numéro de la liste.`);
  return picked?.name ?? null;
}

/** `campaign create ma campagne` sends « ma campagne », which the service refuses with a name to use instead. */
function typedName(args: readonly string[]): string {
  return args.join(' ').trim();
}

async function runCommand(args: string[]): Promise<void> {
  const [command, sub] = args;
  const need = (what: string, usage: string): string => {
    if (what === '') throw new UserError(`Usage : ${COMMAND} ${usage}`);
    return what;
  };
  switch (command) {
    case 'man': case 'help': case '--help': case '-h':
      return console.log(manual((await account())?.admin === true));
    case 'version': case '--version':
      return console.log(`atlas ${VERSION}`);
    case 'login': return signIn();
    case 'logout': return signOut();
    case 'status': return status();
    case 'start': {
      const parsed = startArguments(args.slice(1));
      if (parsed.unknown.length > 0) throw new UserError(`Option inconnue : ${parsed.unknown.join(' ')}. Usage : ${COMMAND} start <nom> [--dev]`);
      return start(need(parsed.name ?? '', 'start <nom> [--dev]'), parsed.channel);
    }
    case 'stop': return stop();
    case 'campaign': {
      const name = typedName(args.slice(2));
      if (sub === 'list') return printCampaigns();
      if (sub === 'create') return createCampaign(need(name, 'campaign create <nom>'));
      if (sub === 'delete') return deleteCampaign(need(name, 'campaign delete <nom>'));
      if (sub === 'vault') return changeVault(need(name, 'campaign vault <nom>'));
      throw new UserError(`Usage : ${COMMAND} campaign list | create <nom> | delete <nom> | vault <nom>`);
    }
    case 'admin': {
      const handle = args[2] ?? '';
      if (sub === 'pending' || sub === 'list') return adminList(sub === 'pending');
      if (sub === 'approve' || sub === 'reject' || sub === 'revoke') return adminDecide(sub, need(handle, `admin ${sub} <pseudo>`));
      throw new UserError(`Usage : ${COMMAND} admin pending | list | approve | reject | revoke <pseudo>`);
    }
    default:
      throw new UserError(`Commande inconnue : ${command ?? ''}. Tape « ${COMMAND} man » pour l'aide.`);
  }
}

/** One turn of the menu; false once the GM leaves (0, Ctrl+C, Ctrl+D). */
async function menuOnce(): Promise<boolean> {
  const who = await account();
  console.log(`\n══════════ ATLAS ${VERSION} ══════════`);
  const notice = await updateNotice();
  if (notice !== null) console.log(`${notice}\n`);
  const items: [string, () => Promise<void>][] = [];
  if (who === null) {
    console.log('Pas connecté.');
    items.push(['Se connecter avec Discord', signIn], ['Aide', async () => console.log(manual(false))]);
  } else {
    await status();
    const pending = who.admin ? await pendingCount() : null;
    if (pending !== null && pending > 0) console.log(`${pending === 1 ? 'Un compte attend' : `${pending} comptes attendent`} ta validation : choisis « Comptes en attente ».`);
    items.push(
      ['Lancer une campagne', async () => { const name = await chooseCampaign('lancer'); if (name !== null) await start(name); }],
      ['Créer une campagne', createFromMenu],
      ['Arrêter la campagne en cours', stop],
      ['Supprimer une campagne', async () => { const name = await chooseCampaign('supprimer'); if (name !== null) await deleteCampaign(name); }],
      ['Mes campagnes', printCampaigns],
      ['Changer le coffre d\'une campagne', async () => { const name = await chooseCampaign('rattacher à un autre coffre'); if (name !== null) await changeVault(name); }],
      ['Aide', async () => console.log(manual(who.admin))],
      ['Se déconnecter', signOut],
    );
    if (who.admin) {
      items.push([`Comptes en attente${pending !== null && pending > 0 ? ` (${pending})` : ''}`, () => adminList(true)]);
      items.push(['Valider, refuser ou révoquer un compte', async () => {
        const handle = ask('Pseudo Discord du compte :');
        const action = ask('1. Valider  2. Refuser  3. Révoquer :');
        const chosen = ({ '1': 'approve', '2': 'reject', '3': 'revoke' } as const)[action as '1' | '2' | '3'];
        if (handle !== '' && chosen !== undefined) await adminDecide(chosen, handle);
        else if (!inputEnded()) console.log('Rien n\'a changé : il faut un pseudo et 1, 2 ou 3.');
      }]);
    }
  }
  items.forEach(([label], index) => console.log(`  ${index + 1}. ${label}`));
  console.log('  0. Quitter');
  const choice = ask('Ton choix :');
  if (choice === '0' || inputEnded()) return false;
  const item = items[Number(choice) - 1];
  if (item === undefined) console.log(`Choix inconnu : « ${choice} ». Tape un des numéros du menu.`);
  else await item[1]();
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
} else if (!Deno.stdin.isTerminal()) {
  // Started without a terminal (a file manager, or input from a pipe): the menu could read nothing and
  // would show itself again forever.
  console.log(`Le menu d'Atlas a besoin d'un terminal. Ouvre un terminal dans ce dossier et tape ${COMMAND}, ou ${COMMAND} man pour les commandes.`);
  Deno.exit(1);
} else {
  // The window stays until the GM leaves, whatever goes wrong in between.
  let again = true;
  while (again) {
    try {
      again = await menuOnce();
    } catch (error) {
      await report(error);
    }
    if (again) pause();
    if (inputEnded()) again = false;
  }
  console.log('À bientôt.');
}

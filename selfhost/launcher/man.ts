import { COMMAND } from './system.ts';

/** `atlas man`: every command, for everyone. The admin part shows only to the administrator. */
export function manual(admin: boolean): string {
  const command = (line: string, what: string): string => `  ${`${COMMAND} ${line}`.padEnd(36)}${what}`;
  const lines = [
    'ATLAS : lancer tes campagnes Atlas VTT en ligne',
    '',
    `Sans commande (${COMMAND} seul dans un terminal${Deno.build.os === 'windows' ? ', ou un double-clic' : ''}), un menu propose tout ce qui suit.`,
    'Ctrl+C ou 0 quitte le menu.',
    '',
    command('man', 'cette aide (aussi : -h, --help)'),
    command('version', 'la version du lanceur'),
    command('login', 'se connecter avec Discord (crée ton compte la première fois)'),
    command('logout', 'se déconnecter de cette machine'),
    command('status', 'ton compte et la campagne en cours'),
    command('campaign list', 'tes campagnes'),
    command('campaign create <nom>', 'crée <nom>-vtt.kunlab.cc (5 campagnes au plus)'),
    command('campaign delete <nom>', 'supprime la campagne et son adresse (après confirmation)'),
    command('campaign vault <nom>', 'choisit un autre coffre Obsidian pour la campagne'),
    command('start <nom>', 'lance la campagne sur cette machine'),
    command('start <nom> --dev', 'la lance avec la version de développement (image dev et son plugin)'),
    command('stop', 'arrête la campagne en cours'),
    '',
    'Un compte neuf attend que l\'administrateur le valide : il est prévenu sur Discord à ta première connexion.',
    'Un nom de campagne : 1 à 30 lettres minuscules, chiffres ou tirets, sans tiret au début ni à la fin.',
    'Les joueurs rejoignent la table par le lien d\'invitation qu\'Obsidian copie (« Copy invite link »), pas par l\'adresse de la campagne.',
    'Une campagne s\'arrête toute seule si personne ne s\'y connecte dans l\'heure, puis 5 minutes après le départ de tout le monde.',
    'Supprimer une campagne garde ses tables sur cette machine (volume Docker atlas-<nom>).',
    'Le lanceur te prévient quand une nouvelle version est disponible.',
  ];
  if (admin) {
    lines.push(
      '',
      'Administration :',
      command('admin pending', 'comptes en attente'),
      command('admin list', 'tous les comptes et leurs campagnes'),
      command('admin approve <pseudo>', 'valide un compte'),
      command('admin reject <pseudo>', 'refuse un compte'),
      command('admin revoke <pseudo>', 'coupe un compte et supprime ses campagnes'),
    );
  }
  return lines.join('\n');
}

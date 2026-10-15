/** `atlas man`: every command, for everyone. The admin part shows only to the administrator. */
export function manual(admin: boolean): string {
  const lines = [
    'ATLAS : lancer tes campagnes Atlas VTT en ligne',
    '',
    'Sans commande (double-clic), un menu propose tout ce qui suit.',
    '',
    '  atlas man                       cette aide',
    '  atlas login                     se connecter avec Discord (crée ton compte la première fois)',
    '  atlas logout                    se déconnecter de cette machine',
    '  atlas status                    ton compte et la campagne en cours',
    '  atlas campaign list             tes campagnes',
    '  atlas campaign create <nom>     crée <nom>-vtt.kunlab.cc (5 campagnes au plus)',
    '  atlas campaign delete <nom>     supprime la campagne et son adresse',
    '  atlas start <nom>               lance la campagne sur cette machine',
    '  atlas stop                      arrête la campagne en cours',
    '',
    'Un nom de campagne : 1 à 30 lettres minuscules, chiffres ou tirets.',
    'Une campagne s\'arrête toute seule 5 minutes après le départ de tout le monde.',
  ];
  if (admin) {
    lines.push(
      '',
      'Administration :',
      '  atlas admin pending             comptes en attente',
      '  atlas admin list                tous les comptes et leurs campagnes',
      '  atlas admin approve <pseudo>    valide un compte',
      '  atlas admin reject <pseudo>     refuse un compte',
      '  atlas admin revoke <pseudo>     coupe un compte et supprime ses campagnes',
    );
  }
  return lines.join('\n');
}

import { CAMPAIGN_NAME } from './config.ts';

const MAX_LENGTH = 30;

/** The name the GM probably meant: small letters, no accents, a dash for every run of anything else. */
export function suggestedName(name: string): string {
  return name.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_LENGTH).replace(/-+$/, '');
}

/**
 * Why `name` is no campaign name, rule by rule, with a name to use instead where one can be made;
 * null for a good name. A campaign `name` is the DNS label `name-vtt`, hence the rules.
 */
export function nameProblem(name: string): string | null {
  if (CAMPAIGN_NAME.test(name)) return null;
  const reasons: string[] = [];
  if (name.trim() === '') return 'Nom vide : tape de 1 à 30 lettres minuscules, chiffres ou tirets.';
  if (name.length > MAX_LENGTH) reasons.push(`trop long (${name.length} caractères, ${MAX_LENGTH} au plus)`);
  if (/\s/.test(name)) reasons.push('pas d\'espace');
  if (/[A-Z]/.test(name)) reasons.push('pas de majuscule');
  if (/[^\x00-\x7f]/.test(name)) reasons.push('pas d\'accent ni de lettre hors de a à z');
  if (/[^A-Za-z0-9\s-]/.test(name.replace(/[^\x00-\x7f]/g, ''))) reasons.push('pas d\'autre signe que le tiret');
  if (/^-|-$/.test(name)) reasons.push('pas de tiret au début ni à la fin');
  const suggestion = suggestedName(name);
  const instead = suggestion !== '' && suggestion !== name && CAMPAIGN_NAME.test(suggestion) ? ` Essaie « ${suggestion} ».` : '';
  return `Nom invalide : ${reasons.join(', ')}. Un nom a de 1 à 30 lettres minuscules, chiffres ou tirets.${instead}`;
}

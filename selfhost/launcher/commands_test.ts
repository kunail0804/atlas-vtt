import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { campaignTable } from './campaigns.ts';
import { startedText } from './commands.ts';

Deno.test('the start says the players need the invite link, not the campaign address', () => {
  const text = startedText('recette', '/home/me/vault', 'https://recette-vtt.kunlab.cc', { atlas: false, statblocks: null, enabled: [] });
  assertStringIncludes(text, 'Copy invite link');
  assertStringIncludes(text, 'ne suffit pas');
  assert(!text.includes('Adresse des joueurs'));
  assert(!text.includes('s\'affiche là'));
  assertStringIncludes(text, 'dans l\'heure');
});

Deno.test('the vault\'s changes come after what to do, with the trust dialog on a first start', () => {
  const text = startedText('recette', '/v', 'https://recette-vtt.kunlab.cc', { atlas: true, statblocks: '4.10.3', enabled: ['atlas-vtt'] });
  assert(text.indexOf('Copy invite link') < text.indexOf('Fantasy Statblocks'));
  assertStringIncludes(text, 'Faire confiance à l\'auteur et activer les modules');
  const again = startedText('recette', '/v', 'https://recette-vtt.kunlab.cc', { atlas: true, statblocks: null, enabled: [] });
  assert(!again.includes('Faire confiance'));
});

Deno.test('campaigns are listed in aligned columns', () => {
  assertEquals(campaignTable([{ name: 'a', origin: 'https://a-vtt.kunlab.cc' }, { name: 'recette', origin: 'https://recette-vtt.kunlab.cc' }]),
    '  a        https://a-vtt.kunlab.cc\n  recette  https://recette-vtt.kunlab.cc');
});

import { assertEquals } from 'jsr:@std/assert@1';
import { enablePlugins, typedPath } from './vault.ts';

Deno.test('plugins are switched on beside the vault\'s own, once each', async () => {
  const vault = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${vault}/.obsidian`);
    await Deno.writeTextFile(`${vault}/.obsidian/community-plugins.json`, JSON.stringify(['dataview', 'atlas-vtt']));
    assertEquals(await enablePlugins(vault, ['atlas-vtt', 'obsidian-5e-statblocks']), ['obsidian-5e-statblocks']);
    assertEquals(JSON.parse(await Deno.readTextFile(`${vault}/.obsidian/community-plugins.json`)), ['dataview', 'atlas-vtt', 'obsidian-5e-statblocks']);
    assertEquals(await enablePlugins(vault, ['atlas-vtt', 'obsidian-5e-statblocks']), []);
  } finally {
    await Deno.remove(vault, { recursive: true });
  }
});

Deno.test('a vault without the list gets one', async () => {
  const vault = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${vault}/.obsidian`);
    assertEquals(await enablePlugins(vault, ['atlas-vtt']), ['atlas-vtt']);
    assertEquals(JSON.parse(await Deno.readTextFile(`${vault}/.obsidian/community-plugins.json`)), ['atlas-vtt']);
  } finally {
    await Deno.remove(vault, { recursive: true });
  }
});

Deno.test('a typed vault path reads ~ as the home folder and drops the quotes a paste brings', () => {
  assertEquals(typedPath('~/Documents/atlas-recette', '/home/me'), '/home/me/Documents/atlas-recette');
  assertEquals(typedPath("'/home/me/Documents/atlas recette'", '/home/me'), '/home/me/Documents/atlas recette');
  assertEquals(typedPath('"/home/me/vault"  ', '/home/me'), '/home/me/vault');
  assertEquals(typedPath('/srv/~vault', '/home/me'), '/srv/~vault');
  assertEquals(typedPath('~other/vault', '/home/me'), '~other/vault');
});

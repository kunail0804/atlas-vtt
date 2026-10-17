import { assertEquals } from 'jsr:@std/assert@1';
import { enablePlugins } from './vault.ts';

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

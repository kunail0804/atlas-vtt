import { assertEquals } from 'jsr:@std/assert@1';
import { imageOf, startArguments } from './channel.ts';

Deno.test('a campaign runs the released image unless --dev asks for develop\'s', () => {
  assertEquals(startArguments(['table']), { name: 'table', channel: 'stable', unknown: [] });
  assertEquals(startArguments(['table', '--dev']), { name: 'table', channel: 'dev', unknown: [] });
  assertEquals(startArguments(['--dev', 'table']), { name: 'table', channel: 'dev', unknown: [] });
  assertEquals(imageOf('stable'), 'kunail0804/atlas-relay:latest');
  assertEquals(imageOf('dev'), 'kunail0804/atlas-relay:dev');
});

Deno.test('an option start does not know is reported, and no name is no name', () => {
  assertEquals(startArguments(['table', '--beta']), { name: 'table', channel: 'stable', unknown: ['--beta'] });
  assertEquals(startArguments(['--dev']).name, undefined);
});

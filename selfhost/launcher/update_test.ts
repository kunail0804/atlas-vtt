import { assertEquals } from 'jsr:@std/assert@1';
import { isNewer, parseVersion } from './update.ts';

Deno.test('compares launcher versions number by number', () => {
  assertEquals(isNewer('0.2.0', '0.1.9'), true);
  assertEquals(isNewer('0.10.0', '0.9.0'), true);
  assertEquals(isNewer('1.0.0', '1.0.0'), false);
  assertEquals(isNewer('0.1.0', '0.2.0'), false);
  assertEquals(isNewer('garbage', '0.1.0'), false);
  assertEquals(parseVersion('1.2'), null);
});

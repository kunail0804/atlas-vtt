import { assertStringIncludes } from 'jsr:@std/assert@1';
import { dockerDownAdvice } from './docker.ts';

Deno.test('Docker Desktop on Linux is told to open Docker Desktop, not systemctl start docker', () => {
  const advice = dockerDownAdvice('linux', 'desktop-linux', 'Cannot connect to the Docker daemon at unix:///home/me/.docker/desktop/docker.sock.');
  assertStringIncludes(advice, 'Docker Desktop');
  assertStringIncludes(advice, 'systemctl --user start docker-desktop');
});

Deno.test('Docker Engine is told to start its service, and Docker Desktop is named as the other case', () => {
  const advice = dockerDownAdvice('linux', 'default', 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.');
  assertStringIncludes(advice, 'sudo systemctl start docker');
  assertStringIncludes(advice, 'Docker Desktop');
});

Deno.test('a user outside the docker group is told so', () => {
  const advice = dockerDownAdvice('linux', 'default', 'permission denied while trying to connect to the Docker daemon socket');
  assertStringIncludes(advice, 'groupe docker');
});

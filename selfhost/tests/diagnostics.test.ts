import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FEEDBACK_PATH, MAX_DIAGNOSTIC_BODY, REPORTS_PATH } from '../../src/app/online/protocol/diagnostics.ts';
import { startTestRelay, stopTestRelay, type TestRelay } from './helpers.ts';

// The plugin's feedback and error reports, kept by the relay in its data folder.
const FEEDBACK = { v: 1, source: 'companion', text: 'Le livre marche bien', diagnostics: null };

describe('feedback and error reports', () => {
  let test: TestRelay;
  afterEach(async () => stopTestRelay(test));

  const post = (route: string, body: string, headers: Record<string, string> = {}): Promise<Response> => fetch(`${test.gmOrigin}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  it('keeps feedback the plugin sends, one line each, as its parser reads it', async () => {
    test = await startTestRelay();
    expect((await post(FEEDBACK_PATH, JSON.stringify(FEEDBACK))).status).toBe(202);
    expect((await post(FEEDBACK_PATH, JSON.stringify({ ...FEEDBACK, text: 'Deuxième' }))).status).toBe(202);
    const lines = readFileSync(path.join(test.dataDir, 'feedback.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { text: string; at: string });
    expect(lines.map((line) => line.text)).toEqual(['Le livre marche bien', 'Deuxième']);
    expect(Number.isNaN(Date.parse(lines[0]?.at ?? ''))).toBe(false);
  });

  it('refuses what is malformed, too large, or sent by a web page', async () => {
    test = await startTestRelay();
    expect((await post(FEEDBACK_PATH, '{"v":2}')).status).toBe(400);
    expect((await post(REPORTS_PATH, 'not json')).status).toBe(400);
    expect((await post(FEEDBACK_PATH, JSON.stringify({ ...FEEDBACK, text: 'x'.repeat(MAX_DIAGNOSTIC_BODY) }))).status).toBe(413);
    expect((await post(FEEDBACK_PATH, JSON.stringify(FEEDBACK), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetch(`${test.gmOrigin}${FEEDBACK_PATH}`)).status).toBe(405);
  });

  it('answers busy once a burst is spent', async () => {
    test = await startTestRelay();
    const statuses: number[] = [];
    for (let index = 0; index < 12; index += 1) statuses.push((await post(FEEDBACK_PATH, JSON.stringify(FEEDBACK))).status);
    expect(statuses.slice(0, 10).every((status) => status === 202)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

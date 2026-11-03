// Compares the compendium build's catalog.json with the sources Atlas downloads
// (src/app/compendium/officialSources.ts), and points Atlas at a new release.
//   node scripts/compendium-sources.mjs check <catalog.json>         exit 1 when a source differs
//   node scripts/compendium-sources.mjs write <catalog.json> <tag>   writes size, sha256, version and RELEASE
// Run by .github/workflows/ci.yml when compendium/builder changes on main.
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCES = new URL('../src/app/compendium/officialSources.ts', import.meta.url);
const [mode, catalogPath, tag] = process.argv.slice(2);
if ((mode !== 'check' && mode !== 'write') || catalogPath === undefined || (mode === 'write' && tag === undefined)) {
  console.error('usage: compendium-sources.mjs check <catalog.json> | write <catalog.json> <tag>');
  process.exit(2);
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
let text = readFileSync(SOURCES, 'utf8');
let differs = false;

for (const entry of catalog) {
  // A source's block runs from its `id:` line to the closing brace of its object.
  const start = text.indexOf(`id: '${entry.id}',`);
  if (start === -1) {
    console.error(`${entry.id}: not in officialSources.ts; add it by hand first`);
    process.exit(2);
  }
  const end = text.indexOf('\n  },', start);
  const block = text.slice(start, end);
  const wanted = { size: String(entry.size), sha256: `'${entry.sha256}'`, version: String(entry.version) };
  let updated = block;
  for (const [key, value] of Object.entries(wanted)) {
    const pattern = new RegExp(`(\\n\\s+${key}: )([^,]+),`);
    const found = block.match(pattern);
    if (found === null) {
      console.error(`${entry.id}: no ${key} in its block`);
      process.exit(2);
    }
    if (found[2] !== value) {
      console.log(`${entry.id}: ${key} ${found[2]} -> ${value}`);
      differs = true;
    }
    updated = updated.replace(pattern, `$1${value},`);
  }
  text = text.slice(0, start) + updated + text.slice(end);
}

if (mode === 'check') {
  console.log(differs ? 'The build differs from what Atlas downloads.' : 'The build is what Atlas downloads.');
  process.exit(differs ? 1 : 0);
}
text = text.replace(/releases\/download\/compendium-v\d+'/, `releases/download/${tag}'`);
writeFileSync(SOURCES, text);
console.log(`officialSources.ts now downloads ${tag}.`);

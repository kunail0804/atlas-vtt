/**
 * Markdown as a compendium page writes it, drawn with elements and text nodes only, never markup:
 * headings, paragraphs, lists, quotes, tables and rules; bold, italics and code; a wikilink or a
 * link shows as its text. Anything else stays as written.
 */

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]*\))/;

/** One line's text with its emphasis, as nodes. */
function inline(text: string): Node[] {
  const nodes: Node[] = [];
  for (const part of text.split(INLINE)) {
    if (part === '') continue;
    if ((part.startsWith('**') && part.endsWith('**') && part.length > 4) || (part.startsWith('__') && part.endsWith('__') && part.length > 4)) {
      const strong = document.createElement('strong');
      strong.append(...inline(part.slice(2, -2)));
      nodes.push(strong);
    } else if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) || (part.startsWith('_') && part.endsWith('_') && part.length > 2)) {
      const em = document.createElement('em');
      em.append(...inline(part.slice(1, -1)));
      nodes.push(em);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      nodes.push(code);
    } else if (part.startsWith('[[') && part.endsWith(']]')) {
      // `[[Note#Heading|Shown]]`: what it shows, else the note's name.
      const inner = part.slice(2, -2);
      const shown = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1) : inner.split('#')[0] ?? inner;
      const link = document.createElement('span');
      link.className = 'md-link';
      link.textContent = shown;
      nodes.push(link);
    } else if (/^\[[^\]]+\]\([^)]*\)$/.test(part)) {
      const link = document.createElement('span');
      link.className = 'md-link';
      link.textContent = part.slice(1, part.indexOf(']'));
      nodes.push(link);
    } else {
      nodes.push(document.createTextNode(part));
    }
  }
  return nodes;
}

const cellsOf = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const isTableRule = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function table(lines: readonly string[]): HTMLElement {
  const element = document.createElement('table');
  const head = element.createTHead().insertRow();
  for (const cell of cellsOf(lines[0] ?? '')) {
    const th = document.createElement('th');
    th.append(...inline(cell));
    head.append(th);
  }
  const body = element.createTBody();
  for (const line of lines.slice(2)) {
    const row = body.insertRow();
    for (const cell of cellsOf(line)) row.insertCell().append(...inline(cell));
  }
  const wrap = document.createElement('div');
  wrap.className = 'md-table';
  wrap.append(element);
  return wrap;
}

/** The blocks of a text, as elements. */
export function markdownBlocks(text: string): HTMLElement[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: HTMLElement[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, (heading[1]?.length ?? 1) + 2);
      const element = document.createElement(`h${level}` as 'h3');
      element.append(...inline(heading[2] ?? ''));
      blocks.push(element);
      index += 1;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(document.createElement('hr'));
      index += 1;
      continue;
    }
    if (line.includes('|') && isTableRule(lines[index + 1] ?? '')) {
      const rows: string[] = [];
      while (index < lines.length && (lines[index] ?? '').includes('|')) rows.push(lines[index++] ?? '');
      blocks.push(table(rows));
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1] ?? '');
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const current = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index] ?? '');
        if (!current) break;
        const li = document.createElement('li');
        li.append(...inline(current[2] ?? ''));
        list.append(li);
        index += 1;
      }
      blocks.push(list);
      continue;
    }
    if (line.startsWith('>')) {
      const quoted: string[] = [];
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) quoted.push((lines[index++] ?? '').replace(/^>\s?/, ''));
      const quote = document.createElement('blockquote');
      quote.append(...markdownBlocks(quoted.join('\n')));
      blocks.push(quote);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || /^(#{1,6})\s/.test(current) || /^\s*([-*+]|\d+[.)])\s/.test(current) || current.startsWith('>') || (current.includes('|') && isTableRule(lines[index + 1] ?? ''))) break;
      paragraph.push(current.trim());
      index += 1;
    }
    const element = document.createElement('p');
    paragraph.forEach((part, at) => {
      if (at > 0) element.append(document.createElement('br'));
      element.append(...inline(part));
    });
    blocks.push(element);
  }
  return blocks;
}

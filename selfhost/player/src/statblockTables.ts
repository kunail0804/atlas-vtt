import type { SheetField, SheetNode } from '../../../src/app/online/protocol/book.ts';
import { MAX_BOOK_TITLE } from '../../../src/app/online/protocol/bookText.ts';
import { node } from './bookDom.ts';
import { drafted, type StatblockContext } from './statblockContext.ts';
import { rollButton } from './statblockControls.ts';
import { writeField } from './statblockFields.ts';
import { TEXT } from './text.ts';

type TableNode = Extract<SheetNode, { k: 'table' }>;

/** A cell as typed: a number where it reads as one, else the line, none for an empty cell. */
function typedCell(text: string): string | number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const number = Number(trimmed.replace(',', '.'));
  return Number.isFinite(number) ? number : trimmed;
}

/** A cell the player may change: sent alone (`cell`), against the base of the whole value. */
function cellInput(context: StatblockContext, field: SheetField, table: TableNode, row: number, column: number, shown: string): HTMLInputElement {
  const input = drafted(context, `${field.key}.${row}.${column}`, field.base, node('input', 'book-input sb-cell-input'), shown);
  input.maxLength = MAX_BOOK_TITLE;
  input.setAttribute('aria-label', TEXT.sheet.cell(table.columns[column] ?? table.label ?? field.key, row + 1));
  input.addEventListener('change', () => writeField(context, field, typedCell(input.value), [row, column]));
  return input;
}

/** A cell as shown: its text, a roll where it has one. */
function cellContent(context: StatblockContext, table: TableNode, text: string | null, roll: string | null | undefined, column: number): Node {
  const shown = text ?? '';
  if (roll === null || roll === undefined) return document.createTextNode(shown);
  const label = [table.label, table.columns[column]].filter((part) => part !== null && part !== undefined && part !== '').join(' ');
  return rollButton(context, roll, label, shown);
}

/**
 * A table of the sheet: its columns, its rows (cells the player may change where its value is
 * theirs) and the rows worked out from them under it (a modifier under each score), read only.
 */
export function tableElement(context: StatblockContext, table: TableNode): HTMLElement {
  const wrap = node('div', 'sb-table-wrap');
  if (table.label !== null) wrap.append(node('span', 'sb-label', table.label));
  const element = node('table', 'sb-table');
  const labelled = table.workedLabels !== undefined && table.workedLabels.some((label) => label !== '');
  const head = element.createTHead().insertRow();
  if (labelled) head.append(node('th', ''));
  for (const column of table.columns) head.append(node('th', '', column));
  const body = element.createTBody();
  const field = context.editable ? table.field : null;
  table.rows.forEach((cells, row) => {
    const line = body.insertRow();
    if (labelled) line.append(node('th', ''));
    table.columns.forEach((_, column) => {
      const text = cells[column] ?? null;
      const cell = line.insertCell();
      if (field !== null) cell.append(cellInput(context, field, table, row, column, text ?? ''));
      else cell.append(cellContent(context, table, text, table.rolls?.[row]?.[column], column));
    });
  });
  table.worked.forEach((cells, row) => {
    const line = body.insertRow();
    line.className = 'sb-worked';
    if (labelled) line.append(node('th', '', table.workedLabels?.[row] ?? ''));
    table.columns.forEach((_, column) => {
      line.insertCell().append(cellContent(context, table, cells[column] ?? null, table.workedRolls?.[row]?.[column], column));
    });
  });
  wrap.append(element);
  return wrap;
}

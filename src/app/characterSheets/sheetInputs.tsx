import React, { useEffect, useState, type ReactElement } from 'react';
import type { CellSpec, SheetRow } from './sheetFields.ts';

/** What every input of a sheet is given: whether it may be changed. */
interface Editable {
  readonly editable: boolean;
}

/**
 * A line of text. What is typed goes up at once (the sheet shows it, its host sends or writes it);
 * the field keeps its own draft so that a value coming back while the player types does not move the caret.
 */
export function TextInput({ value, onChange, editable, label, className, multiline, maxLength }: Editable & { value: string; onChange: (value: string) => void; label: string; className?: string; multiline?: boolean; maxLength?: number }): ReactElement {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const props = {
    className: `atlas-sheet-input ${className ?? ''}`,
    'aria-label': label,
    value: draft,
    readOnly: !editable,
    maxLength,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
  if (multiline) return <textarea {...props} rows={4} onChange={(event) => { setDraft(event.target.value); onChange(event.target.value); }} />;
  return <input {...props} type="text" onChange={(event) => { setDraft(event.target.value); onChange(event.target.value); }} />;
}

/** A whole number within `min` and `max`; what cannot be one is kept as typed until it is. */
export function NumberInput({ value, onChange, editable, label, min, max, className }: Editable & { value: number; onChange: (value: number) => void; label: string; min: number; max: number; className?: string }): ReactElement {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  return (
    <input
      className={`atlas-sheet-input atlas-sheet-number ${className ?? ''}`}
      aria-label={label}
      inputMode="numeric"
      value={draft}
      readOnly={!editable}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(String(value));
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        const number = Number(event.target.value);
        if (event.target.value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max) onChange(number);
      }}
    />
  );
}

export function Check({ value, onChange, editable, label, className }: Editable & { value: boolean; onChange: (value: boolean) => void; label: string; className?: string }): ReactElement {
  return <input type="checkbox" className={`atlas-sheet-check ${className ?? ''}`} aria-label={label} checked={value} disabled={!editable} onChange={(event) => onChange(event.target.checked)} />;
}

/** A value that rolls when clicked (a modifier, a bonus), shown signed. */
export function Roll({ value, label, formula, onRoll, className }: { value: string; label: string; formula: string | null; onRoll: ((formula: string, label: string) => void) | undefined; className?: string }): ReactElement {
  if (onRoll === undefined || formula === null) return <span className={`atlas-sheet-value ${className ?? ''}`}>{value}</span>;
  return <button type="button" className={`atlas-sheet-roll ${className ?? ''}`} aria-label={`${label} : ${value}`} onClick={() => onRoll(formula, label)}>{value}</button>;
}

/** The column of a table: its key in the row, its heading, its cell, and an optional roll from its value. */
export interface RowColumn {
  readonly key: string;
  readonly label: string;
  readonly spec: CellSpec;
  readonly width?: string;
  readonly roll?: (row: SheetRow) => string | null;
}

/** A table of rows: each cell edited in place, a row added at the end or taken out. */
export function RowsTable({ rows, columns, editable, onRow, addLabel, removeLabel, onRoll, label, onView, viewLabel }: Editable & {
  rows: readonly SheetRow[]; columns: readonly RowColumn[]; onRow: (index: number, row: SheetRow | null) => void; addLabel: string; removeLabel: string; label: string;
  onRoll?: ((formula: string, label: string) => void) | undefined;
  /** Opens what a row names (its compendium entry), from a button of its own. */
  onView?: ((row: SheetRow) => void) | undefined;
  viewLabel?: ((row: SheetRow) => string) | undefined;
}): ReactElement {
  const extra = [...(onView !== undefined ? ['28px'] : []), ...(editable ? ['28px'] : [])];
  const empty = (): SheetRow => Object.fromEntries(columns.map(({ key, spec }) => [key, spec.kind === 'int' ? Math.max(0, spec.min) : spec.kind === 'bool' ? false : '']));
  return (
    <div className="atlas-sheet-table" role="group" aria-label={label}>
      <div className="atlas-sheet-table__head" style={{ gridTemplateColumns: template(columns, extra) }}>
        {columns.map((column) => <span key={column.key}>{column.label}</span>)}
        {extra.map((_, index) => <span key={`extra-${index}`} />)}
      </div>
      {rows.map((row, index) => (
        <div key={index} className="atlas-sheet-table__row" style={{ gridTemplateColumns: template(columns, extra) }}>
          {columns.map((column) => <Cell key={column.key} row={row} column={column} editable={editable} onChange={(value) => onRow(index, { ...row, [column.key]: value })} onRoll={onRoll} />)}
          {onView !== undefined && <button type="button" className="atlas-sheet-view" aria-label={viewLabel?.(row) ?? String(row.name ?? '')} onClick={() => onView(row)}>👁</button>}
          {editable && <button type="button" className="atlas-sheet-remove" aria-label={`${removeLabel} ${index + 1}`} onClick={() => onRow(index, null)}>×</button>}
        </div>
      ))}
      {editable && <button type="button" className="atlas-sheet-add" onClick={() => onRow(rows.length, empty())}>{addLabel}</button>}
    </div>
  );
}

const template = (columns: readonly RowColumn[], extra: readonly string[]): string => [...columns.map((column) => column.width ?? '1fr'), ...extra].join(' ');

function Cell({ row, column, editable, onChange, onRoll }: Editable & { row: SheetRow; column: RowColumn; onChange: (value: string | number | boolean) => void; onRoll: ((formula: string, label: string) => void) | undefined }): ReactElement {
  const value = row[column.key];
  const { spec } = column;
  const label = `${column.label} ${String(row.name ?? '')}`.trim();
  if (spec.kind === 'bool') return <Check value={value === true} onChange={onChange} editable={editable} label={label} />;
  if (spec.kind === 'int') return <NumberInput value={typeof value === 'number' ? value : 0} onChange={onChange} editable={editable} label={label} min={spec.min} max={spec.max} />;
  const formula = column.roll?.(row) ?? null;
  if (!editable && formula !== null) return <Roll value={String(value ?? '')} label={label} formula={formula} onRoll={onRoll} />;
  return (
    <span className="atlas-sheet-cell">
      <TextInput value={String(value ?? '')} onChange={onChange} editable={editable} label={label} multiline={spec.kind === 'longtext'} maxLength={spec.max} />
      {formula !== null && onRoll !== undefined && <button type="button" className="atlas-sheet-dice" aria-label={`Lancer ${label}`} onClick={() => onRoll(formula, label)}>🎲</button>}
    </span>
  );
}

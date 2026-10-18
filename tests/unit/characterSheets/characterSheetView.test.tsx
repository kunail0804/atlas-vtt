import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterSheet } from '../../../src/app/characterSheets/CharacterSheet.tsx';
import { DND5E_2024 } from '../../../src/app/characterSheets/dnd5e2024.ts';
import type { SheetRow, SheetValue, SheetValues } from '../../../src/app/characterSheets/sheetFields.ts';
import { applySheetEdit, newSheet } from '../../../src/app/characterSheets/sheetNote.ts';

const start: SheetValues = { ...newSheet(DND5E_2024, 'Mira'), level: 5, stats: [8, 16, 14, 12, 13, 10] };

/** The sheet as a host holds it: every change applied by the system's own rules, and told to the test. */
function Host({ editable, told, rolled }: { editable: boolean; told: (key: string, value: SheetValue | SheetRow | null) => void; rolled: (formula: string, label: string) => void }): ReactElement {
  const [values, setValues] = useState(start);
  return (
    <CharacterSheet system="dnd5e-2024" values={values} editable={editable} onRoll={rolled}
      onSet={(key, value) => {
        told(key, value);
        setValues((current) => applySheetEdit(DND5E_2024, current, { op: 'set', key, value }) ?? current);
      }}
      onRow={(key, index, row) => {
        told(key, row);
        setValues((current) => applySheetEdit(DND5E_2024, current, { op: 'row', key, index, row }) ?? current);
      }} />
  );
}

describe('the 2024 character sheet', () => {
  afterEach(cleanup);

  it('works out what follows from the scores and rolls it when clicked', () => {
    const told = vi.fn();
    const rolled = vi.fn();
    render(<Host editable told={told} rolled={rolled} />);
    expect(screen.getByRole('button', { name: 'Test de Dextérité : +3' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Dextérité'), { target: { value: '18' } });
    expect(told).toHaveBeenCalledWith('stats', [8, 18, 14, 12, 13, 10]);
    fireEvent.click(screen.getByRole('button', { name: 'Test de Dextérité : +4' }));
    expect(rolled).toHaveBeenCalledWith('1d20+4', 'Test de Dextérité');
    // Proficiency in Stealth adds the level 5 bonus of +3; expertise doubles it.
    fireEvent.click(screen.getByLabelText('Maîtrise Discrétion (DEX)'));
    expect(screen.getByRole('button', { name: 'Test de Discrétion : +7' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Expertise Discrétion (DEX)'));
    expect(screen.getByRole('button', { name: 'Test de Discrétion : +10' })).toBeTruthy();
    // Passive Perception: 10 + Wisdom 13 (+1), not proficient.
    expect(screen.getByText('Perception passive').nextElementSibling?.textContent).toBe('11');
  });

  it('adds an attack row, whose bonus and damage roll', () => {
    const rolled = vi.fn();
    render(<Host editable told={vi.fn()} rolled={rolled} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ajouter' })[0]!);
    const [name, bonus, damage] = screen.getAllByRole('textbox').filter((box) => ['Nom', 'Bonus', 'Dégâts'].includes(box.getAttribute('aria-label') ?? ''));
    fireEvent.change(name!, { target: { value: 'Rapière' } });
    fireEvent.change(bonus!, { target: { value: '+6' } });
    fireEvent.change(damage!, { target: { value: '1d8+4 perforant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lancer Dégâts Rapière' }));
    expect(rolled).toHaveBeenCalledWith('1d8+4', 'Dégâts Rapière');
  });

  it('read only, changes nothing', () => {
    const told = vi.fn();
    render(<Host editable={false} told={told} rolled={vi.fn()} />);
    expect((screen.getByLabelText('Nom du personnage') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Maîtrise Discrétion (DEX)') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ajouter' })).toBeNull();
  });
});

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterSheet } from '../../../src/app/characterSheets/CharacterSheet';
import { DND5E_2024 } from '../../../src/app/characterSheets/dnd5e2024';
import { newSheet } from '../../../src/app/characterSheets/sheetNote';
import type { SheetCompendium } from '../../../src/app/characterSheets/sheetCompendium';
import type { SheetValues } from '../../../src/app/characterSheets/sheetFields';

afterEach(cleanup);

function compendium(create?: SheetCompendium['create']): SheetCompendium & { pick: ReturnType<typeof vi.fn>; view: ReturnType<typeof vi.fn> } {
  return {
    choices: vi.fn(async (kind) => (kind === 'class' ? [{ id: 'a1', name: 'Fighter', detail: 'd10' }, { id: 'a2', name: 'Wizard', detail: 'd6' }] : [])),
    pick: vi.fn(),
    view: vi.fn(),
    ...(create !== undefined && { create }),
  };
}

const sheet = (values: SheetValues, reach: SheetCompendium, editable = true): void => {
  render(<CharacterSheet system="dnd5e-2024" values={values} editable={editable} onSet={() => undefined} onRow={() => undefined} compendium={reach} />);
};

describe('the compendium on a character sheet', () => {
  it('picks a class from a list that searches, and offers the GM a new entry with what was typed', async () => {
    const create = vi.fn();
    const reach = compendium(create);
    sheet(newSheet(DND5E_2024, 'Mira'), reach);
    fireEvent.click(screen.getByRole('button', { name: '+ Classe' }));
    const picker = await screen.findByRole('dialog', { name: 'Choisir une classe' });
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: 'wiz' } });
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['Wizardd6']);
    fireEvent.click(within(picker).getByRole('option', { name: /Wizard/ }));
    expect(reach.pick).toHaveBeenCalledWith('class', { id: 'a2', name: 'Wizard', detail: 'd6' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+ Classe' }));
    const again = await screen.findByRole('dialog', { name: 'Choisir une classe' });
    fireEvent.change(within(again).getByRole('searchbox'), { target: { value: 'Artificer' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Créer une classe dans le compendium' }));
    expect(create).toHaveBeenCalledWith('class', 'Artificer');
  });

  it('lists the classes with their levels, each opened to read; a player gets no button to make one', async () => {
    const reach = compendium();
    sheet({ ...newSheet(DND5E_2024, 'Mira'), classes: [{ name: 'Fighter', level: 3, die: 'd10' }], species: 'Elf' }, reach);
    fireEvent.click(screen.getByRole('button', { name: 'Voir Fighter' }));
    expect(reach.view).toHaveBeenCalledWith('class', 'Fighter');
    fireEvent.click(screen.getByRole('button', { name: 'Voir Elf' }));
    expect(reach.view).toHaveBeenCalledWith('species', 'Elf');
    expect((screen.getByRole('textbox', { name: 'Niveau de classe Fighter' }) as HTMLInputElement).value).toBe('3');
    // The level is the classes': it is not typed.
    expect((screen.getByRole('textbox', { name: 'Niveau' }) as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Choisir Espèce' }));
    const picker = await screen.findByRole('dialog', { name: 'Choisir une espèce' });
    expect(within(picker).queryByRole('button', { name: /Créer/ })).toBeNull();
  });

  it('adds weapons, armour and spells from the compendium, and offers nothing to pick on a sheet that cannot change', () => {
    const reach = compendium();
    sheet(newSheet(DND5E_2024, 'Mira'), reach);
    expect(screen.getByRole('button', { name: 'Armure…' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '+ Du compendium' })).toHaveLength(1);
    cleanup();
    sheet(newSheet(DND5E_2024, 'Mira'), reach, false);
    expect(screen.queryByRole('button', { name: '+ Classe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Armure…' })).toBeNull();
  });
});

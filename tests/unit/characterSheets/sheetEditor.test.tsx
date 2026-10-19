import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TFile, type App } from 'obsidian';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SheetEditor } from '../../../src/app/characterSheets/obsidian/CharacterSheetView.tsx';
import { DND5E_2024 } from '../../../src/app/characterSheets/dnd5e2024.ts';
import { newSheet, sheetFrontmatter } from '../../../src/app/characterSheets/sheetNote.ts';

/** Mira's sheet note in a vault whose frontmatter writes tell the metadata cache, as Obsidian's do. */
function vault(): { app: App; file: TFile; frontmatter: () => Record<string, unknown> } {
  const file = new TFile('Personnages/Mira.md');
  const lore = new TFile('Lore/Famille.md');
  let frontmatter: Record<string, unknown> = { ...sheetFrontmatter(DND5E_2024, { ...newSheet(DND5E_2024, 'Mira'), level: 2 }), 'atlas-player-notes': ['[[Famille]]'] };
  const changed: ((file: TFile) => void)[] = [];
  const app = {
    vault: { read: async () => `---\n${JSON.stringify(frontmatter)}\n---\n`, getAbstractFileByPath: () => null },
    fileManager: {
      processFrontMatter: async (_file: TFile, change: (data: Record<string, unknown>) => void) => {
        const next = structuredClone(frontmatter);
        change(next);
        frontmatter = next;
        for (const listener of changed) listener(file);
      },
      generateMarkdownLink: (target: TFile) => `[[${target.basename}]]`,
    },
    metadataCache: {
      on: (_name: string, listener: (file: TFile) => void) => (changed.push(listener), listener),
      offref: () => undefined,
      getFirstLinkpathDest: (link: string) => (link === 'Famille' ? lore : null),
    },
    workspace: { getLeaf: () => ({ openFile: async () => undefined }) },
  } as unknown as App;
  return { app, file, frontmatter: () => frontmatter };
}

const settle = (): Promise<void> => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

describe('the GM\'s character sheet', () => {
  afterEach(cleanup);

  it('shows the note\'s sheet and writes what the GM types into it', async () => {
    const { app, file, frontmatter } = vault();
    render(<SheetEditor app={app} file={file} />);
    await settle();
    expect((screen.getByLabelText('Niveau') as HTMLInputElement).value).toBe('2');
    fireEvent.change(screen.getByLabelText('Classe'), { target: { value: 'Magicienne' } });
    fireEvent.change(screen.getByLabelText('Niveau'), { target: { value: '7' } });
    await settle();
    expect(frontmatter()).toMatchObject({ class: 'Magicienne', level: 7, statblock: true, 'atlas-sheet': 'dnd5e-2024' });
    expect(screen.getByText('Bonus de maîtrise').nextElementSibling?.textContent).toBe('+3');
  });

  it('lists the notes linked for the player and takes one off', async () => {
    const { app, file, frontmatter } = vault();
    render(<SheetEditor app={app} file={file} />);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(screen.getByText('Famille')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    await settle();
    expect(frontmatter()).not.toHaveProperty('atlas-player-notes');
    expect(screen.getByText('Aucune note liée pour l\'instant.')).toBeTruthy();
  });

  it('lets the GM switch the sheet to the 2014 rules, whose words it then uses', async () => {
    const { app, file, frontmatter } = vault();
    render(<SheetEditor app={app} file={file} />);
    await settle();
    expect(screen.getByLabelText('Espèce')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Règles'), { target: { value: 'dnd5e-2014' } });
    await settle();
    expect(frontmatter()).toMatchObject({ 'atlas-sheet': 'dnd5e-2014', name: 'Mira', level: 2 });
    expect((screen.getByLabelText('Règles') as HTMLSelectElement).value).toBe('dnd5e-2014');
    expect(screen.getByLabelText('Race')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Équipement' })).toBeNull();
  });
});

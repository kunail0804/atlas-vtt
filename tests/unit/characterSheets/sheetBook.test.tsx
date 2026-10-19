import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TFile, type App } from 'obsidian';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetBook } from '../../../src/app/characterSheets/obsidian/SheetBook.tsx';
import { setActiveShelf } from '../../../src/app/online/gm/book/activeShelf.ts';
import { BookShelf } from '../../../src/app/online/gm/book/BookShelf.ts';
import { EMPTY_BOOK } from '../../../src/app/online/gm/book/bookStore.ts';

const ART = 'atlas-vtt/collections/Cairn/tokens/mira.png';

// Mira's token is linked to her sheet and lies in the Cairn collection.
vi.mock('../../../src/app/services/TokenStatblockLinkService', () => ({
  TokenStatblockLinkService: { getInstance: () => ({ getTokensLinkedToStatblock: async () => [ART], findAssetByAnyPath: async () => ({ collection: 'cairn' }) }) },
}));
vi.mock('../../../src/app/services/AssetService', () => ({
  AssetService: { getInstance: () => ({ getCollection: async (id: string) => (id === 'cairn' ? { name: 'Cairn' } : null) }) },
}));

const file = new TFile('Personnages/Mira.md');
const app = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } as unknown as App;
const settle = (): Promise<void> => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

describe('the Book tab of the GM\'s character sheet', () => {
  afterEach(() => {
    cleanup();
    setActiveShelf(null);
  });

  it('asks for online play while no shelf keeps the books', async () => {
    render(<SheetBook app={app} file={file} />);
    await settle();
    expect(screen.getByText(/Active « Online play »/)).toBeTruthy();
  });

  it('opens the book of the token linked to the sheet, and writes the GM\'s items and coins into it as the GM\'s', async () => {
    const shelf = new BookShelf();
    const writers: string[] = [];
    shelf.subscribe((collection, key, by) => writers.push(`${collection}|${key}|${by}`));
    setActiveShelf(shelf);
    render(<SheetBook app={app} file={file} />);
    await settle();
    expect(screen.getByText('Aucun objet pour l\'instant.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un objet' }));
    fireEvent.change(screen.getByLabelText('Nom de l\'objet'), { target: { value: 'Corde' } });
    fireEvent.change(screen.getByLabelText('Propriétés, une par ligne : « CA : 14 »'), { target: { value: 'Poids : 5 lb\nsans valeur' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l\'objet' }));
    await settle();
    expect(shelf.of('cairn', ART).items).toMatchObject([{ name: 'Corde', properties: [{ label: 'Poids', value: '5 lb' }], tone: null }]);
    expect(screen.getByText('Corde')).toBeTruthy();
    expect(writers).toEqual([`cairn|${ART}|gm`]);

  });

  it('shows what the player writes as it comes, and takes an item away', async () => {
    const shelf = new BookShelf();
    const rope = { id: 'a'.repeat(24), name: 'Corde', type: null, rarity: null, tone: null, price: null, description: null, properties: [], at: 1 };
    shelf.keep('cairn', ART, { ...EMPTY_BOOK, items: [rope], purse: [{ name: 'Or', amount: 3 }] });
    setActiveShelf(shelf);
    render(<SheetBook app={app} file={file} />);
    await settle();
    expect(screen.getByText('Corde')).toBeTruthy();
    expect((screen.getByLabelText('Quantité 1') as HTMLInputElement).value).toBe('3');
    act(() => shelf.keep('cairn', ART, { ...shelf.of('cairn', ART), items: [rope, { ...rope, id: 'b'.repeat(24), name: 'Lanterne' }] }));
    expect(screen.getByText('Lanterne')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer' })[1]!);
    await settle();
    expect(shelf.of('cairn', ART).items.map((item) => item.name)).toEqual(['Lanterne']);

    fireEvent.change(screen.getByLabelText('Quantité 1'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la bourse' }));
    await settle();
    expect(shelf.of('cairn', ART).purse).toEqual([{ name: 'Or', amount: 12 }]);
  });

  it('refuses what a book could not read back, and keeps the form for the GM to fix', async () => {
    const shelf = new BookShelf();
    setActiveShelf(shelf);
    render(<SheetBook app={app} file={file} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un objet' }));
    fireEvent.change(screen.getByLabelText('Nom de l\'objet'), { target: { value: 'Grimoire' } });
    const lines = Array.from({ length: 17 }, (_, at) => `Page ${at} : sort`).join('\n');
    fireEvent.change(screen.getByLabelText('Propriétés, une par ligne : « CA : 14 »'), { target: { value: lines } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l\'objet' }));
    await settle();
    expect(shelf.of('cairn', ART).items).toEqual([]);
    expect((screen.getByLabelText('Nom de l\'objet') as HTMLInputElement).value).toBe('Grimoire');
  });

  it('finds the book the character\'s first game makes, in the scene\'s collection', async () => {
    const shelf = new BookShelf();
    setActiveShelf(shelf);
    render(<SheetBook app={app} file={file} />);
    await settle();
    const lantern = { id: 'c'.repeat(24), name: 'Lanterne', type: null, rarity: null, tone: null, price: null, description: null, properties: [], at: 1 };
    act(() => shelf.keep('scenes', ART, { ...EMPTY_BOOK, items: [lantern] }));
    await settle();
    expect(screen.getByText('Lanterne')).toBeTruthy();
  });
});

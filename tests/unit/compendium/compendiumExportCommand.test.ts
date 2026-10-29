import { describe, expect, it } from 'vitest';
import { bookFolderOf, compendiumBookFolders } from '../../../src/app/compendium/compendiumFileMenu';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

describe('the command that exports a compendium book', () => {
  it('finds the book a note lies in, and nothing outside the books', () => {
    expect(bookFolderOf('Compendium/D&D 5e 2014/Personal/Spells/Ash Bolt.md')).toBe('Compendium/D&D 5e 2014/Personal');
    expect(bookFolderOf('Compendium/D&D 5e 2014')).toBeNull();
    expect(bookFolderOf('Notes/Compendium/A/B/c.md')).toBeNull();
  });

  it('offers every book folder of the vault but the Personal ones, by system then book', async () => {
    const { app } = createInMemoryApp();
    await app.vault.create('Compendium/D&D 5e 2024/SRD 5.2.1/Spells/Fireball.md', 'fire');
    await app.vault.create('Compendium/D&D 5e 2014/Homebrew/Spells/Ash Bolt.md', 'ash');
    await app.vault.create('Compendium/D&D 5e 2014/Personal/Spells/Mine.md', 'mine');
    await app.vault.create('Compendium/Loose note.md', 'loose');
    // The Personal book is never exported.
    expect(compendiumBookFolders(app).map((folder) => folder.path)).toEqual(['Compendium/D&D 5e 2014/Homebrew', 'Compendium/D&D 5e 2024/SRD 5.2.1']);
  });
});

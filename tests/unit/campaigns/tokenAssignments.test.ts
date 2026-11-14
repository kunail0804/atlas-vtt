import { describe, expect, it } from 'vitest';
import { withPlayer } from '../../../src/app/campaigns/players/playersFile';
import { emptyTablePlayers } from '../../../src/app/campaigns/players/tablePlayersFile';
import { readTokenAssignments, withPlayerTokens, withTokenOwners } from '../../../src/app/campaigns/players/tokenAssignments';

const ANA = 'a'.repeat(20);
const MAP = 'Scenes/Cave.atlasmap';

describe('the tokens the table\'s players file assigns', () => {
  it('are written beside the players, who stay as they were, and an empty field is left out', () => {
    const file = withPlayer(emptyTablePlayers(), { id: ANA, name: 'Ana', code: '123456', characters: ['hero'] }, 1);
    const given = withPlayerTokens(withTokenOwners(file, ['gm-1', 'gm-2'], ANA), MAP, ['gm-1'], true);
    expect(given).toMatchObject({ players: file.players, tokenOwners: { 'gm-1': ANA, 'gm-2': ANA }, playerTokens: { [MAP]: { 'gm-1': true } } });
    const taken = withTokenOwners(given, ['gm-1', 'gm-2'], null);
    expect(taken).not.toHaveProperty('tokenOwners');
    expect(readTokenAssignments(taken)).toEqual({ owners: {}, playerTokens: { [MAP]: { 'gm-1': true } } });
  });

  it('are read only where they can be trusted', () => {
    const file = {
      ...emptyTablePlayers(),
      tokenOwners: { 'gm-1': ANA, 'gm-2': 'nobody', 'gm-3': 7, ['x'.repeat(300)]: ANA },
      playerTokens: { [MAP]: { 'gm-1': true, 'gm-2': 'yes', ['x'.repeat(300)]: true }, 'Scenes/Empty.atlasmap': { 'gm-3': 1 }, ['p'.repeat(1001)]: { 'gm-4': true }, 'Scenes/Bad.atlasmap': [] },
    };
    expect(readTokenAssignments(file)).toEqual({ owners: { 'gm-1': ANA }, playerTokens: { [MAP]: { 'gm-1': true } } });
    expect(readTokenAssignments({ ...emptyTablePlayers(), tokenOwners: 'garbage', playerTokens: 3 })).toEqual({ owners: {}, playerTokens: {} });
  });

  it('are never written into a file of a later format', () => {
    const newer = { ...emptyTablePlayers(), format: 99 };
    expect(withTokenOwners(newer, ['gm-1'], ANA)).toBe(newer);
    expect(withPlayerTokens(newer, MAP, ['gm-1'], true)).toBe(newer);
  });
});

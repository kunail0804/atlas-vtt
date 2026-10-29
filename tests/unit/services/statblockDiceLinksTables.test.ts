import { describe, expect, it } from 'vitest';
import { linkDiceIn } from '../../../src/app/services/statblockDiceLinks';

/** The formulas `linkDiceIn` made links of in `html`, in order. */
function linked(html: string): string[] {
  const root = document.createElement('div');
  root.innerHTML = html;
  linkDiceIn(root);
  return [...root.querySelectorAll<HTMLElement>('.atlas-dice-link')].map((link) => link.dataset.formula ?? '');
}

const CLASS_TABLE = `<table>
  <thead><tr><th>Level</th><th>Proficiency Bonus</th><th>Rage Damage</th><th>Sneak Attack</th></tr></thead>
  <tbody><tr><td>1st</td><td>+2</td><td>+2</td><td>1d6</td></tr></tbody>
</table>`;

describe('roll links in a table', () => {
  it('leave a class table\'s bonuses as text and keep its dice', () => {
    expect(linked(CLASS_TABLE)).toEqual(['1d6']);
  });

  it('make a bonus a roll in a column named for one', () => {
    const table = '<table><thead><tr><th>Weapon</th><th>Attack Bonus</th><th>Save</th></tr></thead><tbody><tr><td>Dagger</td><td>+5</td><td>+3</td></tr></tbody></table>';
    expect(linked(table)).toEqual(['+5', '+3']);
  });

  it('never in a header cell', () => {
    expect(linked('<table><thead><tr><th>+2 to hit</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>')).toEqual([]);
  });

  it('keep the text around a bonus that stays text', () => {
    const root = document.createElement('div');
    root.innerHTML = '<table><thead><tr><th>Proficiency Bonus</th></tr></thead><tbody><tr><td>+2 and 1d4</td></tr></tbody></table>';
    linkDiceIn(root);
    expect(root.querySelector('td')?.textContent).toBe('+2 and 1d4');
    expect(root.querySelector('td .atlas-dice-link')?.textContent).toBe('1d4');
  });

  it('leave running text as it was: a bare bonus there is a roll', () => {
    expect(linked('<p>Melee Weapon Attack: +4 to hit, 1d6 + 2 piercing damage.</p>')).toEqual(['+4', '1d6+2']);
  });
});

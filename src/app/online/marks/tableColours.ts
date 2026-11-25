import { GM_MARKS, playerTone } from '../protocol/index.ts';
import { getDomHost } from '../../host/dom';

/** The colour class of a sender at the table (`_player-colours.scss`): a player's tone, or the GM's accent. */
export const colourClass = (who: string): string => `atlas-online-colour-${who === GM_MARKS ? 'gm' : String(playerTone(who))}`;

const RGB = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/;
const hexByte = (value: string): string => Math.min(255, Number(value)).toString(16).padStart(2, '0');

/**
 * The colour a player has at the table, as `#rrggbb`: the one their cursor, the GM's panel and the
 * table log show them in (`--atlas-online-player`), read from the styles of `doc`, so it follows that
 * page's theme. Null for the GM, whose marks keep the colour they are told in, and where the styles
 * give no colour that can be read.
 */
export function tableColourOf(who: string, doc: Document): string | null {
  if (who === GM_MARKS || doc.body === null) return null;
  const probe = getDomHost().createDiv(doc.body, `atlas-online-colour-probe ${colourClass(who)}`);
  try {
    const match = RGB.exec(doc.defaultView?.getComputedStyle(probe).color ?? '');
    return match === null ? null : `#${hexByte(match[1] ?? '0')}${hexByte(match[2] ?? '0')}${hexByte(match[3] ?? '0')}`;
  } finally {
    probe.remove();
  }
}

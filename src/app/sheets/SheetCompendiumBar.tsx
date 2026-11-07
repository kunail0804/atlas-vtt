import React, { useState, type ReactElement } from 'react';
import { PICK_KINDS, type PickKind, type SheetCompendium } from '../compendium/pickKinds';
import { CompendiumPicker } from './CompendiumPicker';
import { SHEET_TEXT } from './sheetText';
import './sheet.css';

/**
 * A button per kind of compendium entry a character takes (a class, a spell, a weapon…), above the
 * character's statblock: the GM's panel and the player's page alike. A choice is written into the
 * statblock's fields by the GM's Atlas (`sheetPickPatches`).
 */
export function SheetCompendiumBar({ compendium }: { compendium: SheetCompendium }): ReactElement {
  const [picking, setPicking] = useState<PickKind | null>(null);
  return (
    <div className="atlas-sheet-compendium" role="toolbar" aria-label={SHEET_TEXT.compendium.title}>
      {PICK_KINDS.map((kind) => (
        <button key={kind} type="button" className="atlas-sheet-add" onClick={() => setPicking(kind)}>{SHEET_TEXT.pick.button[kind]}</button>
      ))}
      {picking !== null && <CompendiumPicker kind={picking} compendium={compendium} onClose={() => setPicking(null)} />}
    </div>
  );
}

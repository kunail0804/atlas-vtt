import type { ReactElement } from 'react';
import React from 'react';
import { Dnd5eSheet, type CharacterSheetProps } from './Dnd5eSheet.tsx';
import './character-sheet.css';

/** The sheet of a system, by its id; null for a system this Atlas draws no sheet for. */
export function CharacterSheet({ system, ...props }: CharacterSheetProps & { system: string }): ReactElement | null {
  if (system === 'dnd5e-2024') return <Dnd5eSheet {...props} />;
  return null;
}

export type { CharacterSheetProps, SheetHitPoints } from './Dnd5eSheet.tsx';

import { useEffect, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { RollMessage, SharedRoll } from '../../../src/app/online/protocol/dice.ts';
import { throwStyle } from '../../../src/app/dice3d/diceDisplay.ts';
import { diceSceneToShow } from '../../../src/app/dice3d/rollPresentation.ts';
import { DiceRollStack } from '../../../src/app/react/components/dice3d/DiceRollStack.tsx';
import { closeRoll, dismissRoll, pushRoll, type StackedRoll } from '../../../src/app/react/components/dice3d/rollStackState.ts';
import type { DiceRollResult } from '../../../src/app/types/diceTypes.ts';

/** A roll as the plugin's dice take it: the inverse of `sharedRoll` in RollShare.ts. */
export function resultOf(roll: SharedRoll): DiceRollResult {
  return {
    id: roll.id, timestamp: roll.timestamp, formula: roll.formula, modifiers: roll.modifiers, total: roll.total,
    rolls: roll.rolls.map((die) => ({ ...die })),
    ...(roll.crit === undefined ? {} : { crit: roll.crit }),
    ...(roll.linear === false ? { linear: false as const } : {}),
    ...(roll.source === undefined ? {} : { source: { ...roll.source } }),
  };
}

type Listener = (roll: StackedRoll) => void;

function DiceArea({ subscribe }: { readonly subscribe: (listener: Listener) => () => void }): ReactElement {
  const [rolls, setRolls] = useState<readonly StackedRoll[]>([]);
  useEffect(() => subscribe((roll) => setRolls((current) => pushRoll(current, roll))), [subscribe]);
  return (
    <DiceRollStack
      rolls={rolls}
      muted={false}
      onClose={(id) => setRolls((current) => closeRoll(current, id))}
      onDone={(id) => setRolls((current) => dismissRoll(current, id))}
      useAvatar={() => null}
    />
  );
}

/**
 * Rolls thrown in 3D as the GM's player window throws them, with the plugin's own stack: the
 * newest large, older ones shrunk to rows, each naming who rolled. The log keeps every roll too.
 */
export class DiceView {
  private readonly listeners = new Set<Listener>();
  private readonly nameOf: (who: string) => string | null;

  constructor(host: HTMLElement, nameOf: (who: string) => string | null) {
    this.nameOf = nameOf;
    const area = document.createElement('div');
    area.className = 'atlas-vtt-plugin atlas-dice-rolls dice-area';
    host.append(area);
    const subscribe = (listener: Listener): (() => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    createRoot(area).render(<DiceArea subscribe={subscribe} />);
  }

  roll(message: RollMessage): void {
    const result = resultOf(message.result);
    const scene = diceSceneToShow(result, 'full');
    if (scene === null) return;
    const roll: StackedRoll = { result, sourcePresentation: { name: this.nameOf(message.who), avatar: null }, scene, style: throwStyle('full') };
    for (const listener of this.listeners) listener(roll);
  }
}

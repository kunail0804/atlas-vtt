import type { CompendiumChoice, PickKind, SheetCompendium } from '../../../src/app/characterSheets/sheetCompendium.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';

/** How long the sheet waits for the GM's list before it says the compendium does not answer. */
const CHOICES_WAIT_MS = 10_000;

/**
 * The compendium as the player's sheet reaches it: through the GM, who knows the campaign's books.
 * The list of a kind is asked for and comes back (`receive`); a pick and a reading are asked for, and
 * the GM's answer is the sheet and the book as they change, or the page to read.
 */
export class PlayerSheetCompendium implements SheetCompendium {
  private readonly waiting = new Map<PickKind, Array<{ resolve: (choices: readonly CompendiumChoice[]) => void; reject: (error: Error) => void; timer: number }>>();

  constructor(private readonly send: (message: PlayerMessage) => void, private readonly reading: () => void) {}

  choices(kind: PickKind): Promise<readonly CompendiumChoice[]> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiting.set(kind, (this.waiting.get(kind) ?? []).filter((entry) => entry.timer !== timer));
        reject(new Error('The GM did not answer.'));
      }, CHOICES_WAIT_MS);
      this.waiting.set(kind, [...(this.waiting.get(kind) ?? []), { resolve, reject, timer }]);
      this.send({ t: 'sheet-choices', kind });
    });
  }

  /** The GM's list of a kind: every sheet waiting for it gets it. */
  receive(kind: PickKind, choices: readonly CompendiumChoice[]): void {
    for (const entry of this.waiting.get(kind) ?? []) {
      window.clearTimeout(entry.timer);
      entry.resolve(choices);
    }
    this.waiting.delete(kind);
  }

  pick(kind: PickKind, choice: CompendiumChoice): void {
    this.send({ t: 'sheet-pick', kind, id: choice.id });
  }

  view(kind: PickKind, name: string): void {
    this.reading();
    this.send({ t: 'sheet-view', kind, name });
  }
}

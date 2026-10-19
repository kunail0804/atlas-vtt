import type { BookShelf } from './BookShelf.ts';

/**
 * The books online play keeps on this device, for the character sheet's Book tab, which lives outside
 * online play. Null while online play is off or has not read its data yet.
 */
let shelf: BookShelf | null = null;
const listeners = new Set<() => void>();

export function activeShelf(): BookShelf | null {
  return shelf;
}

export function setActiveShelf(next: BookShelf | null): void {
  shelf = next;
  for (const listener of [...listeners]) listener();
}

/** Hears when the shelf comes or goes. */
export function onActiveShelf(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

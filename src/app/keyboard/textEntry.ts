/** Elements whose keys belong to the text in them: Mod+A selects that text, letters type. */
const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, [role="textbox"]';

/**
 * Whether `target` is a `type` (an `Element`, an `HTMLElement`), in any window: a popout's elements
 * are not `instanceof` this window's classes, so Obsidian's `instanceOf` asks. A page without
 * Obsidian (the self-hosted player page, which shares the dice tray) has no `instanceOf` and only
 * one window: `instanceof` asks there.
 */
export function isNodeOf<T extends Node>(target: EventTarget | null, type: abstract new (...args: never[]) => T): target is T {
  const node = target as (Node & { instanceOf?: (type: abstract new (...args: never[]) => T) => boolean }) | null;
  if (!node) return false;
  return typeof node.instanceOf === 'function' ? node.instanceOf(type) : node instanceof type;
}

/** Whether a key event's target is a text field or lies inside one, in any window (`isNodeOf`). */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return isNodeOf(target, Element) && target.closest(TEXT_ENTRY) !== null;
}

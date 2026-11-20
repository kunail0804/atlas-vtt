/** Elements whose keys belong to the text in them: Mod+A selects that text, letters type. */
const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, [role="textbox"]';

/**
 * Whether a key event's target is a text field or lies inside one, in any window: a popout's
 * elements are not `instanceof` this window's classes, so Obsidian's `instanceOf` asks. A page
 * without Obsidian (the self-hosted player page, which shares the dice tray) has no `instanceOf`
 * and only one window: `instanceof` asks there.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const node = target as (Node & { instanceOf?: (type: typeof Element) => boolean }) | null;
  if (!node) return false;
  const isElement = typeof node.instanceOf === 'function' ? node.instanceOf(Element) : node instanceof Element;
  return isElement && (node as unknown as Element).closest(TEXT_ENTRY) !== null;
}

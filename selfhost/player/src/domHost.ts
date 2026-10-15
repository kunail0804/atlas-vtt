import { installDomHost } from '../../../src/app/host/dom.ts';

/** The plugin's shared renderers make their canvases and elements through this host; in Obsidian the plugin installs its own. */
export function installBrowserDomHost(): void {
  installDomHost({
    createCanvas(doc = document, size) {
      const canvas = doc.createElement('canvas');
      if (size) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      return canvas;
    },
    createDiv(parent, cls) {
      const div = parent.ownerDocument.createElement('div');
      div.className = cls;
      parent.appendChild(div);
      return div;
    },
    ownerWindow(node) {
      const doc = node.ownerDocument ?? (node as Document);
      return doc.defaultView ?? window;
    },
    activeDocument: () => document,
  });
}

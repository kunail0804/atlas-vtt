import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import css from '../../src/app/services/player-window.scss?inline';
import { removePlayerCurtain, showPlayerCurtain } from '../../src/app/services/playerCurtain';
import { SCENE_DIP_MS } from '../../src/app/services/playerSceneFade';

/**
 * The player window's canvas under the real stylesheet: a live frame is rendered for the
 * window, so nothing is fitted or cropped; a frame with fewer pixels (the pixel budget) is
 * scaled up smoothly; and a frame held while the DM is on another scene tab, which keeps the
 * shape it was taken with, covers the window.
 */
describe('the player window\'s canvas', () => {
  const style = document.createElement('style');
  style.textContent = css;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    document.head.appendChild(style);
    document.body.classList.add('atlas-player-window', 'atlas-player-window--live');
    canvas = document.createElement('canvas');
    canvas.id = 'atlas-player-canvas';
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    canvas.remove();
    style.remove();
    document.body.classList.remove('atlas-player-window', 'atlas-player-window--live');
  });

  it('fills the window, so the window\'s size is the canvas\' own', () => {
    const box = canvas.getBoundingClientRect();
    expect([box.left, box.top]).toEqual([0, 0]);
    expect([canvas.clientWidth, canvas.clientHeight]).toEqual([window.innerWidth, window.innerHeight]);
    expect(canvas.clientWidth).toBeGreaterThan(0);
  });

  it('keeps its place and size whatever pixels a frame has: a frame of the window\'s size, a capped one, a held one of another shape', () => {
    for (const [width, height] of [[window.innerWidth, window.innerHeight], [Math.round(window.innerWidth / 1.5), Math.round(window.innerHeight / 1.5)], [300, 900]] as const) {
      canvas.width = width;
      canvas.height = height;
      const box = canvas.getBoundingClientRect();
      expect([box.width, box.height]).toEqual([window.innerWidth, window.innerHeight]);
    }
  });

  it('scales a frame with fewer pixels than the window smoothly, never by repeating pixels', () => {
    expect(getComputedStyle(canvas).imageRendering).toBe('auto');
  });

  it('covers the window with a held frame of another shape, from its middle', () => {
    const computed = getComputedStyle(canvas);
    expect(computed.objectFit).toBe('cover');
    expect(computed.objectPosition).toBe('50% 50%');
  });

  // Since the curtain fades through Motion's WAAPI animator (0d526f994), the stylesheet only says where the sheet rests.
  it('fades the curtain\'s sheet in the time the dip to black waits for it', async () => {
    showPlayerCurtain(document, false);
    const sheet = document.body.querySelector<HTMLElement>(':scope > .atlas-player-curtain')!;
    try {
      expect(getComputedStyle(sheet).opacity).toBe('0');
      showPlayerCurtain(document, true);
      const [fade, ...others] = sheet.getAnimations();
      expect(others).toEqual([]);
      expect(fade!.effect!.getTiming().duration).toBe(SCENE_DIP_MS);
      expect((fade!.effect as KeyframeEffect).getKeyframes().map((frame) => Number(frame.opacity))).toEqual([0, 1]);
      fade!.finish();
      await fade!.finished;
      expect(getComputedStyle(sheet).opacity).toBe('1');
    } finally {
      removePlayerCurtain(document);
    }
  });
});

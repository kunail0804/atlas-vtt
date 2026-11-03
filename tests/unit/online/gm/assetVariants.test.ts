// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AssetVariants, REENCODE_MIN_BYTES, type ScaleImage, type ScaledImage } from '../../../../src/app/online/gm/assetVariants.ts';

/** Bytes that read as a PNG of `width` × `height` (its header only), padded to `size`. */
function pngOf(width: number, height: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A scaler that encodes to `copyBytes` bytes and reports the original's size, as `scaleInWindow` does. */
function scaler(copyBytes: number): { scale: ScaleImage; calls: { mime: string; maxSide: number }[] } {
  const calls: { mime: string; maxSide: number }[] = [];
  const scale: ScaleImage = (bytes, mime, maxSide): Promise<ScaledImage | null> => {
    calls.push({ mime, maxSide });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Promise.resolve({ bytes: new Uint8Array(copyBytes).fill(7), mime: 'image/webp', width: view.getUint32(16), height: view.getUint32(20) });
  };
  return { scale, calls };
}

const HASH = 'f'.repeat(64);

describe('the copies the GM makes of images players ask for', () => {
  it('sends a large PNG that fits the side as a smaller WebP copy, drawn at the PNG\'s size', async () => {
    const { scale } = scaler(412_342);
    const variant = await new AssetVariants(scale).get(HASH, pngOf(1448, 1086, 2_797_337), 'image/png', 8192);
    expect(variant).toMatchObject({ width: 1448, height: 1086, ref: { size: 412_342, mime: 'image/webp' } });
  });

  it('sends a small image that fits as it is, without making a copy', async () => {
    const { scale, calls } = scaler(10);
    const variant = await new AssetVariants(scale).get(HASH, pngOf(512, 512, REENCODE_MIN_BYTES), 'image/png', 8192);
    expect(variant).toBeNull();
    expect(calls).toEqual([]);
  });

  it('sends a large image that fits as it is when its copy is no smaller, and a GIF that fits as it is', async () => {
    const bigger = scaler(3_000_000);
    expect(await new AssetVariants(bigger.scale).get(HASH, pngOf(1448, 1086, 2_797_337), 'image/png', 8192)).toBeNull();
    const gif = scaler(10);
    const gifBytes = pngOf(1448, 1086, 2_797_337);
    expect(await new AssetVariants(gif.scale).get(HASH, gifBytes, 'image/gif', 8192)).toBeNull();
    expect(gif.calls).toEqual([]);
  });

  it('still scales down an image larger than the side, even where the copy has more bytes', async () => {
    const { scale, calls } = scaler(500_000);
    const variant = await new AssetVariants(scale).get(HASH, pngOf(10_000, 5_000, 300_000), 'image/png', 8192);
    expect(calls).toEqual([{ mime: 'image/png', maxSide: 8192 }]);
    expect(variant).toMatchObject({ width: 10_000, height: 5_000, ref: { size: 500_000 } });
  });
});

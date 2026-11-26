import test from 'node:test';
import assert from 'node:assert/strict';
import { evalNailHalfWidth } from '../src/lib/nail3DGeometry.ts';
import { extractTrueUVPixelsFromBuffer } from '../src/lib/perFingerVisionAnalyzer.ts';
import type { NailUvPinTarget } from '../src/types/nail.ts';

test('V13 Silhouette-Conformed TrueUV: 0% green background pixels leak into almond tip corners (v > 0.75)', () => {
  const srcW = 300;
  const srcH = 400;
  const srcPixels = new Uint8ClampedArray(srcW * srcH * 4);

  // Paint vivid green background (0, 220, 40) everywhere, and a realistic gold almond nail inside!
  const cx = 150;
  const cy = 200;
  const nailW = 100;
  const nailH = 180;

  for (let y = 0; y < srcH; y++) {
    // v = 0 at bottom of nail (cy + nailH/2), v = 1 at top of nail (cy - nailH/2)
    const v = (cy + nailH * 0.5 - y) / nailH;
    for (let x = 0; x < srcW; x++) {
      const idx = (y * srcW + x) * 4;
      let isNail = false;
      if (v >= 0 && v <= 1) {
        const hw = evalNailHalfWidth(v, 'almond', { bedFraction: 0.58 }) * nailW;
        if (Math.abs(x - cx) <= hw) {
          isNail = true;
        }
      }
      if (isNail) {
        // Warm champagne gold nail pixel
        srcPixels[idx] = 216;
        srcPixels[idx + 1] = 178;
        srcPixels[idx + 2] = 122;
        srcPixels[idx + 3] = 255;
      } else {
        // Vivid green shirt/background pixel
        srcPixels[idx] = 0;
        srcPixels[idx + 1] = 220;
        srcPixels[idx + 2] = 40;
        srcPixels[idx + 3] = 255;
      }
    }
  }

  const target: NailUvPinTarget = {
    cxNorm: cx / srcW,
    cyNorm: cy / srcH,
    widthNorm: nailW / srcW,
    heightNorm: nailH / srcH,
    angleRad: -Math.PI / 2, // pointing straight UP
    detectedFromPhoto: true,
  };

  const outSize = 512;
  const uvPixels = extractTrueUVPixelsFromBuffer(
    srcPixels,
    srcW,
    srcH,
    target,
    outSize,
    'almond'
  );

  // Inspect entire tip region (v > 0.75 => py < 0.25 * outSize) including left/right corners!
  let greenLeakPixels = 0;
  let totalTipPixels = 0;
  const tipMaxPy = Math.floor(outSize * 0.25);

  for (let py = 0; py < tipMaxPy; py++) {
    for (let px = 0; px < outSize; px++) {
      totalTipPixels++;
      const idx = (py * outSize + px) * 4;
      const r = uvPixels[idx];
      const g = uvPixels[idx + 1];
      const b = uvPixels[idx + 2];
      // Green background signature: G strongly dominates R & B
      if (g > r + 25 && g > b + 35) {
        greenLeakPixels++;
      }
    }
  }

  assert.equal(
    greenLeakPixels,
    0,
    `Detected ${greenLeakPixels}/${totalTipPixels} green background pixels leaking into almond tip corners!`
  );
});

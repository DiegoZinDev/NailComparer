import type { FingerId, NailDesign, NailFingerDesignSpec } from '../types/nail';
import { renderProceduralNailSwatchDataUrl } from './proceduralPBRSynthesizer';

const PRIORITY_FINGERS: FingerId[] = ['ring', 'middle', 'index', 'thumb', 'pinky'];

function pickPrimaryPatchUrl(design: NailDesign): string | null {
  if (design.fingerSpecs) {
    for (const fid of PRIORITY_FINGERS) {
      const spec = design.fingerSpecs[fid];
      if (spec?.uvPatchDataUrl) {
        return spec.uvPatchDataUrl;
      }
    }
  }
  return design.imageDataUrl || null;
}

function pickPrimaryFingerSpec(design: NailDesign): NailFingerDesignSpec | null {
  if (!design.fingerSpecs) return null;
  for (const fid of PRIORITY_FINGERS) {
    const spec = design.fingerSpecs[fid];
    if (spec?.uvPatchDataUrl) return spec;
  }
  return design.fingerSpecs.middle ?? design.fingerSpecs.ring ?? null;
}

/**
 * Generates a crisp circular thumbnail data URL or CSS background preview
 * matching the reconstructed nail design.
 * When `uvPatchDataUrl` is present on the design's `fingerSpecs` (or `imageDataUrl`),
 * renders the REAL reconstructed nail texture with subtle C-curve shading & gel specular highlight —
 * never generic brown placeholders!
 */
export function getSwatchBackground(design: NailDesign): string {
  const realPatchUrl = pickPrimaryPatchUrl(design);
  if (realPatchUrl) {
    return [
      'radial-gradient(ellipse 32% 62% at 34% 34%, rgba(255,255,255,0.44) 0%, rgba(255,255,255,0.08) 52%, transparent 78%)',
      'linear-gradient(90deg, rgba(16,8,10,0.28) 0%, transparent 24%, transparent 76%, rgba(16,8,10,0.30) 100%)',
      `url("${realPatchUrl}") center/cover no-repeat`,
    ].join(', ');
  }

  const base = design.baseColor || '#D4A383';
  const secondary = design.secondaryColor || '#FFFFFF';
  const accent = design.accentColor || '#F3D5C0';

  switch (design.patternType) {
    case 'french':
      return `linear-gradient(160deg, ${secondary} 0%, ${secondary} 32%, ${accent} 34%, ${base} 42%, ${base} 100%)`;
    case 'ombre':
      return `linear-gradient(180deg, ${secondary} 0%, ${base} 78%)`;
    case 'chrome':
      return `linear-gradient(135deg, ${base} 0%, ${secondary} 45%, ${accent} 70%, ${base} 100%)`;
    case 'marble':
      return `radial-gradient(circle at 30% 30%, ${secondary} 0%, transparent 45%), linear-gradient(135deg, ${base} 0%, ${accent} 50%, ${base} 100%)`;
    case 'gold-foil':
      return `radial-gradient(circle at 68% 35%, ${secondary} 0%, ${accent} 18%, transparent 32%), radial-gradient(circle at 32% 68%, ${secondary} 0%, transparent 24%), ${base}`;
    case 'cat-eye':
      return `linear-gradient(125deg, ${base} 12%, ${secondary} 48%, ${accent} 53%, ${base} 88%)`;
    case 'aurora':
      return `linear-gradient(135deg, ${base} 0%, ${secondary} 48%, ${accent} 100%)`;
    case 'solid':
    default:
      return `radial-gradient(circle at 32% 28%, ${accent}55 0%, transparent 45%), linear-gradient(155deg, ${base} 0%, ${secondary} 140%)`;
  }
}

/**
 * Generates a high-fidelity nail silhouette swatch DataURL directly from either a `NailFingerDesignSpec`
 * or a `NailDesign`, rendering the real `uvPatchDataUrl` inside an anatomical salon nail silhouette
 * with C-curve shading and gel specular sheen when available.
 */
export function generateNailSwatchDataUrl(
  input: NailDesign | NailFingerDesignSpec,
  width = 180,
  height = 260
): string {
  if ('fingerId' in input) {
    return renderProceduralNailSwatchDataUrl(input, width, height);
  }

  const primarySpec = pickPrimaryFingerSpec(input);
  if (primarySpec) {
    return renderProceduralNailSwatchDataUrl(primarySpec, width, height);
  }

  const fallbackSpec: NailFingerDesignSpec = {
    fingerId: 'middle',
    detectedFromPhoto: false,
    shape: input.detectedShape ?? 'almond',
    relativeLength: input.detectedLength ?? 1.05,
    relativeWidth: 1.0,
    baseColor: input.baseColor || '#D4A383',
    secondaryColor: input.secondaryColor || '#FFFFFF',
    accentColor: input.accentColor || '#D4AF37',
    pattern:
      input.patternType === 'french'
        ? 'french_tip'
        : input.patternType === 'chrome'
          ? 'chrome_mirror'
          : input.patternType === 'gold-foil' || input.patternType === 'marble'
            ? 'gold_3d_waves'
            : input.patternType === 'ombre' || input.patternType === 'aurora'
              ? 'aura_gradient'
              : 'solid_gloss',
    strokeAnchors: [],
    metallicIntensity: input.finish === 'chrome' || input.finish === 'glitter' ? 0.85 : 0.12,
    glossIntensity: input.finish === 'velvet' ? 0.56 : 0.96,
    uvPatchDataUrl: input.imageDataUrl ?? undefined,
  };

  return renderProceduralNailSwatchDataUrl(fallbackSpec, width, height);
}

/**
 * Asynchronous rasterized Canvas swatch renderer (useful when consumers require a PNG data URL
 * baked from `uvPatchDataUrl` / `imageDataUrl` rather than an inline SVG data URL).
 */
export async function renderAsyncNailSwatchPng(
  input: NailDesign | NailFingerDesignSpec,
  width = 180,
  height = 260
): Promise<string> {
  const dataUrl = generateNailSwatchDataUrl(input, width, height);
  if (dataUrl.startsWith('data:image/png')) return dataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function getStudioMonogram(studioName: string): string {
  const words = studioName
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return 'NA';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

import type { FingerId, NailDesign, NailFingerDesignSpec } from '../types/nail';
import { buildFingerSpecsFromStudioDesign } from './perFingerVisionAnalyzer';
import {
  renderBlueprintNailCanvas,
  renderProceduralNailSwatchDataUrl,
} from './proceduralPBRSynthesizer';

const PRIORITY_FINGERS: FingerId[] = ['ring', 'middle', 'index', 'thumb', 'pinky'];
const swatchBgCache = new Map<string, string>();

function pickPrimaryFingerSpec(design: NailDesign): NailFingerDesignSpec {
  if (design.fingerSpecs) {
    for (const fid of PRIORITY_FINGERS) {
      const spec = design.fingerSpecs[fid];
      if (spec?.blueprint && spec.blueprint.artElements.length > 0) {
        return spec;
      }
    }
    for (const fid of PRIORITY_FINGERS) {
      const spec = design.fingerSpecs[fid];
      if (spec) return spec;
    }
  }
  const built = buildFingerSpecsFromStudioDesign(design);
  return built.ring ?? built.middle;
}

/**
 * Generates a crisp circular thumbnail preview (`background`) rendered EXCLUSIVELY via the
 * V10 clean vector PBR blueprint compiler (`renderBlueprintNailCanvas` / `renderProceduralNailSwatchDataUrl`)
 * — ZERO raw photo patches or `uvPatchDataUrl`.
 */
export function getSwatchBackground(design: NailDesign): string {
  const spec = pickPrimaryFingerSpec(design);
  const bp = spec.blueprint;
  const cacheKey = [
    design.id,
    spec.shape,
    spec.baseColor,
    spec.secondaryColor,
    spec.accentColor,
    spec.pattern,
    bp?.baseLayer.gradientMode ?? '',
    bp?.borderLayer.kind ?? '',
    bp?.artElements.length ?? 0,
  ].join('|');

  const cached = swatchBgCache.get(cacheKey);
  if (cached) return cached;

  if (typeof document !== 'undefined') {
    try {
      const canvas = renderBlueprintNailCanvas(spec, 96, 96);
      const dataUrl = canvas.toDataURL('image/png', 0.9);
      const css = `url("${dataUrl}") center/contain no-repeat, radial-gradient(circle at 34% 30%, ${spec.baseColor}44 0%, #161114 85%)`;
      if (swatchBgCache.size > 48) {
        const firstKey = swatchBgCache.keys().next().value;
        if (firstKey) swatchBgCache.delete(firstKey);
      }
      swatchBgCache.set(cacheKey, css);
      return css;
    } catch {
      // Fallback to pure CSS gradient below if canvas unavailable
    }
  }

  const base = spec.baseColor || '#D4A383';
  const secondary = spec.secondaryColor || '#FFFFFF';
  const accent = spec.accentColor || '#D4AF37';

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
 * Generates a high-fidelity nail silhouette swatch DataURL directly from a `NailDesign`
 * or `NailFingerDesignSpec` using the 100% vector V10 `NailDesignBlueprint` renderer.
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
  return renderProceduralNailSwatchDataUrl(primarySpec, width, height);
}

/**
 * Asynchronous rasterized PNG swatch renderer backed by `renderProceduralNailSwatchDataUrl`.
 */
export async function renderAsyncNailSwatchPng(
  input: NailDesign | NailFingerDesignSpec,
  width = 180,
  height = 260
): Promise<string> {
  return generateNailSwatchDataUrl(input, width, height);
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

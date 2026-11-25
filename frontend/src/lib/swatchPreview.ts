import type { FingerId, NailDesign, NailFingerDesignSpec } from '../types/nail';
import { buildFingerSpecsFromStudioDesign } from './perFingerVisionAnalyzer';
import {
  hashFingerSpec,
  renderBlueprintNailCanvas,
  renderProceduralNailSwatchDataUrl,
} from './proceduralPBRSynthesizer';

const PRIORITY_FINGERS: FingerId[] = ['ring', 'middle', 'index', 'thumb', 'pinky'];
const swatchBgCache = new Map<string, string>();

function pickPrimaryFingerSpec(design: NailDesign): NailFingerDesignSpec {
  const handSets: Array<Partial<Record<FingerId, NailFingerDesignSpec>> | undefined> = [
    design.fingerSpecs,
    design.handSpecsBySide?.Right,
    design.handSpecsBySide?.Left,
  ];

  // 1. Prioritize any finger carrying a rendered 3D preview + rich 3D/artistic detail
  for (const fingerMap of handSets) {
    if (!fingerMap) continue;
    for (const fid of PRIORITY_FINGERS) {
      const spec = fingerMap[fid];
      if (
        spec?.preview3DDataUrl &&
        ((spec.manufacturingSpec &&
          (spec.manufacturingSpec.accessories3D.length > 0 ||
            spec.manufacturingSpec.strokes3D.length > 0 ||
            spec.manufacturingSpec.motifs.length > 0)) ||
          (spec.blueprint && spec.blueprint.artElements.length > 0))
      ) {
        return spec;
      }
    }
  }

  // 2. Any finger carrying a rendered 3D preview (`preview3DDataUrl`)
  for (const fingerMap of handSets) {
    if (!fingerMap) continue;
    for (const fid of PRIORITY_FINGERS) {
      const spec = fingerMap[fid];
      if (spec?.preview3DDataUrl) return spec;
    }
  }

  // 3. Any finger carrying rich V11 manufacturingSpec or V10 blueprint elements
  for (const fingerMap of handSets) {
    if (!fingerMap) continue;
    for (const fid of PRIORITY_FINGERS) {
      const spec = fingerMap[fid];
      if (
        spec &&
        ((spec.manufacturingSpec &&
          (spec.manufacturingSpec.accessories3D.length > 0 ||
            spec.manufacturingSpec.strokes3D.length > 0 ||
            spec.manufacturingSpec.motifs.length > 0)) ||
          (spec.blueprint && spec.blueprint.artElements.length > 0))
      ) {
        return spec;
      }
    }
    for (const fid of PRIORITY_FINGERS) {
      const spec = fingerMap[fid];
      if (spec) return spec;
    }
  }

  const built = buildFingerSpecsFromStudioDesign(design);
  return built.ring ?? built.middle;
}

/**
 * Generates a crisp circular thumbnail preview (`background`):
 * - Prioritizes `spec.preview3DDataUrl` (real Three.js offscreen studio 3D snapshot — NEVER a raw photo crop!)
 * - Falls back cleanly to the V11/V10 vector PBR compiler (`renderBlueprintNailCanvas`).
 */
export function getSwatchBackground(design: NailDesign): string {
  const spec = pickPrimaryFingerSpec(design);
  const baseHex =
    spec.manufacturingSpec?.trueBaseColorHex ||
    spec.blueprint?.baseLayer.baseColorHex ||
    spec.baseColor ||
    '#D4A383';

  if (spec.preview3DDataUrl) {
    return `url("${spec.preview3DDataUrl}") center/cover no-repeat, radial-gradient(circle at 34% 30%, ${baseHex}44 0%, #161114 85%)`;
  }

  const cacheKey = `${design.id}|${hashFingerSpec(spec)}`;
  const cached = swatchBgCache.get(cacheKey);
  if (cached) return cached;

  if (typeof document !== 'undefined') {
    try {
      const canvas = renderBlueprintNailCanvas(spec, 96, 96);
      const dataUrl = canvas.toDataURL('image/png', 0.9);
      const css = `url("${dataUrl}") center/contain no-repeat, radial-gradient(circle at 34% 30%, ${baseHex}44 0%, #161114 85%)`;
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

  const base = baseHex || '#D4A383';
  const secondary =
    spec.manufacturingSpec?.secondaryColorHex || spec.secondaryColor || '#FFFFFF';
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
 * or `NailFingerDesignSpec`:
 * - Prioritizes `spec.preview3DDataUrl` (snapshot rendered by Three.js `OffscreenNailRenderSession` —
 *   NEVER a raw photo crop!) when available on `spec` or `design.fingerSpecs`.
 * - Falls back to `renderProceduralNailSwatchDataUrl` (V11 `manufacturingSpec` + V10 `blueprint`).
 */
export function generateNailSwatchDataUrl(
  input: NailDesign | NailFingerDesignSpec,
  width = 180,
  height = 260
): string {
  if ('fingerId' in input) {
    if (input.preview3DDataUrl) {
      return input.preview3DDataUrl;
    }
    return renderProceduralNailSwatchDataUrl(input, width, height);
  }
  const primarySpec = pickPrimaryFingerSpec(input);
  if (primarySpec.preview3DDataUrl) {
    return primarySpec.preview3DDataUrl;
  }
  return renderProceduralNailSwatchDataUrl(primarySpec, width, height);
}

/**
 * Asynchronous rasterized PNG/JPEG swatch renderer prioritizing `preview3DDataUrl`
 * and backed by `renderProceduralNailSwatchDataUrl`.
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


import type {
  FingerId,
  NailDesign,
  NailFingerDesignSpec,
  NailRenderStrategy,
} from '../types/nail';
import { buildFingerSpecsFromStudioDesign } from './perFingerVisionAnalyzer';
import {
  hashFingerSpec,
  renderBlueprintNailCanvas,
  renderProceduralNailSwatchDataUrl,
} from './proceduralPBRSynthesizer';

const PRIORITY_FINGERS: FingerId[] = ['ring', 'middle', 'index', 'thumb', 'pinky'];
const swatchBgCache = new Map<string, string>();
const trueUvSwatchCache = new Map<string, string>();

function getEffectiveStrategy(spec: NailFingerDesignSpec): NailRenderStrategy {
  return (
    spec.renderStrategy ??
    spec.manufacturingSpec?.renderStrategy ??
    (spec.trueUvDataUrl ? 'canonical_uv_delighted' : 'procedural_pbr_3d')
  );
}

function shouldUseTrueUvSwatch(spec: NailFingerDesignSpec): boolean {
  const effectiveStrategy = getEffectiveStrategy(spec);
  return (
    (effectiveStrategy === 'canonical_uv_delighted' ||
      effectiveStrategy === 'hybrid_uv_plus_pbr_3d') &&
    Boolean(spec.trueUvDataUrl)
  );
}

function pickPrimaryFingerSpec(design: NailDesign): NailFingerDesignSpec {
  const handSets: Array<Partial<Record<FingerId, NailFingerDesignSpec>> | undefined> = [
    design.fingerSpecs,
    design.handSpecsBySide?.Right,
    design.handSpecsBySide?.Left,
  ];

  // 1. Respect explicit Dual-Path priority: procedural_pbr_3d prefers preview3DDataUrl,
  //    canonical_uv_delighted / hybrid_uv_plus_pbr_3d prefers trueUvDataUrl
  for (const fingerMap of handSets) {
    if (!fingerMap) continue;
    for (const fid of PRIORITY_FINGERS) {
      const spec = fingerMap[fid];
      if (!spec) continue;
      if (getEffectiveStrategy(spec) === 'procedural_pbr_3d' && spec.preview3DDataUrl) {
        return spec;
      }
      if (shouldUseTrueUvSwatch(spec)) {
        return spec;
      }
    }
  }

  // 2. Any finger carrying a rendered 3D preview (`preview3DDataUrl`) or TrueUV texture
  for (const fingerMap of handSets) {
    if (!fingerMap) continue;
    for (const fid of PRIORITY_FINGERS) {
      const spec = fingerMap[fid];
      if (spec?.preview3DDataUrl || spec?.trueUvDataUrl) return spec;
    }
  }

  // 3. Any finger carrying rich V11/V13 manufacturingSpec or V10 blueprint elements
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
 * Builds an anatomical salon nail silhouette SVG wrapping the real 512x512 True UV texture
 * with subtle C-curve cylindrical shading and liquid UV-gel specular gloss.
 */
function buildTrueUvNailSvgDataUrl(
  trueUvDataUrl: string,
  shape: NailFingerDesignSpec['shape'],
  width = 180,
  height = 260
): string {
  const key = `${shape}|${width}x${height}|${trueUvDataUrl.length}|${trueUvDataUrl.slice(-24)}`;
  const cached = trueUvSwatchCache.get(key);
  if (cached) return cached;

  const escapedHref = trueUvDataUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const padX = width * 0.14;
  const padY = height * 0.06;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const x0 = padX;
  const x1 = padX + w;
  const cx = width * 0.5;
  const yTop = padY;
  const yBot = padY + h;

  let pathD: string;
  if (shape === 'square') {
    pathD = `M ${x0 + w * 0.08} ${yTop} Q ${cx} ${yTop - h * 0.01} ${x1 - w * 0.08} ${yTop} Q ${x1} ${yTop} ${x1} ${yTop + h * 0.07} L ${x1} ${yBot - h * 0.16} Q ${x1} ${yBot} ${cx} ${yBot} Q ${x0} ${yBot} ${x0} ${yBot - h * 0.16} L ${x0} ${yTop + h * 0.07} Q ${x0} ${yTop} ${x0 + w * 0.08} ${yTop} Z`;
  } else if (shape === 'coffin') {
    pathD = `M ${x0 + w * 0.22} ${yTop} L ${x1 - w * 0.22} ${yTop} Q ${x1 - w * 0.14} ${yTop} ${x1} ${yTop + h * 0.42} L ${x1} ${yBot - h * 0.16} Q ${x1} ${yBot} ${cx} ${yBot} Q ${x0} ${yBot} ${x0} ${yBot - h * 0.16} L ${x0} ${yTop + h * 0.42} Q ${x0 + w * 0.14} ${yTop} ${x0 + w * 0.22} ${yTop} Z`;
  } else if (shape === 'stiletto') {
    pathD = `M ${cx} ${yTop} Q ${x1} ${yTop + h * 0.34} ${x1} ${yBot - h * 0.18} Q ${x1} ${yBot} ${cx} ${yBot} Q ${x0} ${yBot} ${x0} ${yBot - h * 0.18} Q ${x0} ${yTop + h * 0.34} ${cx} ${yTop} Z`;
  } else {
    // almond / oval / natural
    pathD = `M ${cx} ${yTop} C ${x1 - w * 0.08} ${yTop} ${x1} ${yTop + h * 0.24} ${x1} ${yBot - h * 0.16} Q ${x1} ${yBot} ${cx} ${yBot} Q ${x0} ${yBot} ${x0} ${yBot - h * 0.16} C ${x0} ${yTop + h * 0.24} ${x0 + w * 0.08} ${yTop} ${cx} ${yTop} Z`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="nc"><path d="${pathD}"/></clipPath>
    <linearGradient id="cc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000" stop-opacity="0.30"/>
      <stop offset="18%" stop-color="#000" stop-opacity="0.06"/>
      <stop offset="46%" stop-color="#fff" stop-opacity="0.14"/>
      <stop offset="78%" stop-color="#000" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.32"/>
    </linearGradient>
    <linearGradient id="gl" x1="0.18" y1="0.05" x2="0.82" y2="0.65">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.44"/>
      <stop offset="28%" stop-color="#fff" stop-opacity="0.08"/>
      <stop offset="55%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#nc)">
    <image href="${escapedHref}" x="${x0}" y="${yTop}" width="${w}" height="${h}" preserveAspectRatio="none"/>
    <rect x="${x0}" y="${yTop}" width="${w}" height="${h}" fill="url(#cc)"/>
    <rect x="${x0}" y="${yTop}" width="${w}" height="${h}" fill="url(#gl)"/>
  </g>
  <path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.4"/>
</svg>`;

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (trueUvSwatchCache.size > 48) {
    const first = trueUvSwatchCache.keys().next().value;
    if (first) trueUvSwatchCache.delete(first);
  }
  trueUvSwatchCache.set(key, url);
  return url;
}

/**
 * Generates a crisp circular thumbnail preview (`background`) respecting V13 Dual-Path routing:
 * - `procedural_pbr_3d`: prioritizes real 3D render (`preview3DDataUrl`) or procedural blueprint canvas
 *   (chrome + 3D spheres), ignoring any fallback `trueUvDataUrl`.
 * - `canonical_uv_delighted` / `hybrid_uv_plus_pbr_3d`: prioritizes silhouette-conformed `trueUvDataUrl`
 *   inside the anatomical nail silhouette with C-curve cylindrical shading and UV-gel gloss.
 */
export function getSwatchBackground(design: NailDesign): string {
  const spec = pickPrimaryFingerSpec(design);
  const effectiveStrategy = getEffectiveStrategy(spec);
  const baseHex =
    spec.manufacturingSpec?.trueBaseColorHex ||
    spec.blueprint?.baseLayer.baseColorHex ||
    spec.baseColor ||
    '#D4A383';

  if (effectiveStrategy === 'procedural_pbr_3d') {
    if (spec.preview3DDataUrl) {
      return `url("${spec.preview3DDataUrl}") center/cover no-repeat, radial-gradient(circle at 34% 30%, ${baseHex}44 0%, #161114 85%)`;
    }
  } else if (shouldUseTrueUvSwatch(spec) && spec.trueUvDataUrl) {
    const svgUrl = buildTrueUvNailSvgDataUrl(spec.trueUvDataUrl, spec.shape, 96, 132);
    return `url("${svgUrl}") center/contain no-repeat, radial-gradient(circle at 34% 30%, ${baseHex}44 0%, #161114 85%)`;
  } else if (spec.preview3DDataUrl) {
    return `url("${spec.preview3DDataUrl}") center/cover no-repeat, radial-gradient(circle at 34% 30%, ${baseHex}44 0%, #161114 85%)`;
  }

  if (design.imageDataUrl && design.imageDataUrl.startsWith('data:image/')) {
    return `url("${design.imageDataUrl}") center/contain no-repeat, radial-gradient(circle at 34% 30%, ${baseHex}44 0%, #161114 85%)`;
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

function renderSpecSwatchDataUrl(
  spec: NailFingerDesignSpec,
  width: number,
  height: number
): string {
  const effectiveStrategy = getEffectiveStrategy(spec);
  if (effectiveStrategy === 'procedural_pbr_3d') {
    if (spec.preview3DDataUrl) {
      return spec.preview3DDataUrl;
    }
    return renderProceduralNailSwatchDataUrl(spec, width, height);
  }
  if (shouldUseTrueUvSwatch(spec) && spec.trueUvDataUrl) {
    return buildTrueUvNailSvgDataUrl(spec.trueUvDataUrl, spec.shape, width, height);
  }
  if (spec.preview3DDataUrl) {
    return spec.preview3DDataUrl;
  }
  return renderProceduralNailSwatchDataUrl(spec, width, height);
}

export function generateNailSwatchDataUrl(
  input: NailDesign | NailFingerDesignSpec,
  width = 180,
  height = 260
): string {
  if ('fingerId' in input) {
    return renderSpecSwatchDataUrl(input, width, height);
  }
  const primarySpec = pickPrimaryFingerSpec(input);
  return renderSpecSwatchDataUrl(primarySpec, width, height);
}

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
    .filter((w) => w.length > 0 && !['de', 'da', 'do', 'das', 'dos', 'e', '&'].includes(w.toLowerCase()));
  if (words.length === 0) return 'NA';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

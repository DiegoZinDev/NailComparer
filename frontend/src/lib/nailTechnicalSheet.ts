import type {
  FingerId,
  Nail3DAccessoryKind,
  Nail3DAccessorySpec,
  Nail3DBorderType,
  Nail3DFinishType,
  Nail3DMotifKind,
  Nail3DStrokeSpec,
  NailExtensionLevel,
  NailFingerDesignSpec,
  NailFinishV10,
  NailShape,
  NailTechnicalSheet,
  NailTechnicalSheetFinger,
} from '../types/nail';

export interface GenerateNailTechnicalSheetInput {
  designName?: string;
  studioName?: string;
  fingerSpecs: Record<FingerId, NailFingerDesignSpec>;
  predominantShape?: NailShape;
  extensionLevel?: NailExtensionLevel;
  summaryPt?: string;
}

const ORDERED_FINGERS: readonly FingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const FINGER_LABEL_PT: Record<FingerId, string> = {
  thumb: 'Polegar',
  index: 'Indicador',
  middle: 'Médio',
  ring: 'Anelar',
  pinky: 'Mínimo',
};

const SHAPE_LABEL_PT: Record<NailShape, string> = {
  natural: 'Natural',
  oval: 'Oval',
  almond: 'Amendoada',
  coffin: 'Bailarina',
  square: 'Quadrada',
  stiletto: 'Stiletto',
};

const FINISH_3D_LABEL_PT: Record<Nail3DFinishType, string> = {
  mirror_chrome: 'Cromado Espelhado',
  glazed_pearl: 'Perolado/Glazed',
  solid_gloss_gel: 'Gel Brilhante',
  jelly_translucent: 'Jelly Translúcido',
  cat_eye_magnetic: 'Olho de Gato',
  velvet_matte: 'Fosco/Veludo',
  glitter_suspension: 'Glitter',
};

const FINISH_V10_LABEL_PT: Record<NailFinishV10, string> = {
  chrome_mirror: 'Cromado Espelhado',
  pearl_glazed: 'Perolado/Glazed',
  glossy_gel: 'Gel Brilhante',
  jelly_translucent: 'Jelly Translúcido',
  cat_eye: 'Olho de Gato',
  velvet_matte: 'Fosco/Veludo',
};

const MOTIF_LABEL_PT: Record<Nail3DMotifKind, string> = {
  flower_5petal: 'Motivo floral',
  flower_4petal: 'Motivo floral',
  cherry: 'Detalhe de cereja',
  heart: 'Detalhe de coração',
  star_4pt: 'Estrela decorativa',
  bow_3d: 'Laço decorativo 3D',
  marble_veins: 'Efeito mármore',
  tortoiseshell_spots: 'Efeito tartaruga',
  aura_bloom: 'Efeito aura central',
  abstract_organic: 'Arte abstrata orgânica',
};

const ACCESSORY_BASE_LABEL_PT: Record<Nail3DAccessoryKind, string> = {
  metal_stud_sphere: 'Esfera Metálica',
  metal_stud_flat: 'Rebite Metálico',
  pearl_dome: 'Pérola 3D',
  rhinestone: 'Strass/Cristal',
  caviar_bead: 'Microesfera Caviar',
  '3d_drop_clear': 'Gota 3D Translúcida',
};

function normalizeHex(raw: string | undefined, fallback = '#D9C2B4'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const clean = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(clean)) return clean.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`.toUpperCase();
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = normalizeHex(hex).slice(1);
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(hexA: string, hexB: string): number {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const [l1, a1, b1Lab] = rgbToLab(r1, g1, b1);
  const [l2, a2, b2Lab] = rgbToLab(r2, g2, b2);
  return Math.hypot(l1 - l2, a1 - a2, b1Lab - b2Lab);
}

function classifyMetallicTonePt(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const spread = maxC - minC;

  if (spread <= 24) {
    if (maxC >= 165) return 'Prateada';
    if (maxC <= 85) return 'Grafite';
    return 'Prateada';
  }
  if (r > g && g > b && r - b >= 28) {
    if (r - g > 38 && g - b < 30) return 'Rosé';
    return 'Dourada';
  }
  return '';
}

function formatExtensionLevelPt(
  spec: NailFingerDesignSpec,
  fallbackExtension?: NailExtensionLevel
): string {
  const ratio =
    spec.manufacturingSpec?.freeEdgeRatio ??
    spec.freeEdgeRatio ??
    (spec.relativeLength ? Math.max(0.12, spec.relativeLength - 1) : undefined);

  if (typeof ratio === 'number' && Number.isFinite(ratio)) {
    if (ratio <= 0.25) return 'Curta/Natural';
    if (ratio <= 0.5) return 'Pouco Alongada';
    if (ratio <= 0.82) return 'Alongada';
    return 'Muito Alongada';
  }

  const level = spec.extensionLevel ?? fallbackExtension;
  if (!level) return 'Pouco Alongada';
  if (level === 'Muito Alongada (Extrema)') return 'Muito Alongada';
  return level;
}

function normalizeExtensionLabel(level: NailExtensionLevel): string {
  return level === 'Muito Alongada (Extrema)' ? 'Muito Alongada' : level;
}

function resolveFinishLabelPt(spec: NailFingerDesignSpec): string {
  if (spec.manufacturingSpec?.finishType) {
    return FINISH_3D_LABEL_PT[spec.manufacturingSpec.finishType] ?? 'Gel Brilhante';
  }
  if (spec.finishStyle) {
    return FINISH_V10_LABEL_PT[spec.finishStyle] ?? 'Gel Brilhante';
  }
  if (spec.pattern === 'chrome_mirror') return 'Cromado Espelhado';
  return 'Gel Brilhante';
}

function resolveBorderDetailPt(
  borderType: Nail3DBorderType,
  isMetallic: boolean,
  is3DRaised: boolean
): string | null {
  switch (borderType) {
    case 'classic_french':
      return isMetallic ? 'Francesinha clássica metálica' : 'Francesinha clássica';
    case 'micro_french':
      return isMetallic ? 'Micro francesinha metálica' : 'Micro francesinha';
    case 'deep_v_french':
      return isMetallic ? 'Francesinha em V metálica' : 'Francesinha em V';
    case 'full_perimeter_outline':
      if (isMetallic && is3DRaised) return 'Contorno metálico em relevo 3D';
      if (isMetallic) return 'Contorno metálico';
      return is3DRaised ? 'Contorno em relevo 3D' : 'Contorno perimetral';
    case 'cuticle_cuff':
      return isMetallic ? 'Detalhe metálico na cutícula' : 'Detalhe na cutícula';
    case 'none':
    default:
      return null;
  }
}

function describeStrokesPt(strokes: Nail3DStrokeSpec[]): string[] {
  if (strokes.length === 0) return [];
  const details: string[] = [];
  const metallicStrokes = strokes.filter((s) => s.isMetallic || s.metalness >= 0.65);
  const pigmentStrokes = strokes.filter((s) => !s.isMetallic && s.metalness < 0.65);

  if (metallicStrokes.length > 0) {
    const tone = classifyMetallicTonePt(metallicStrokes[0].colorHex);
    const toneAdjective =
      tone === 'Dourada'
        ? 'dourados'
        : tone === 'Prateada'
          ? 'prateados'
          : tone === 'Rosé'
            ? 'rosé'
            : 'metálicos';
    const hasRelief = metallicStrokes.some((s) => s.reliefHeight >= 0.35);
    details.push(
      hasRelief ? `Traços ${toneAdjective} em relevo 3D` : `Traços ${toneAdjective}`
    );
  }

  if (pigmentStrokes.length > 0) {
    const hasRelief = pigmentStrokes.some((s) => s.reliefHeight >= 0.35);
    details.push(
      hasRelief ? 'Traços artísticos em relevo 3D' : 'Traços artísticos pintados'
    );
  }

  return details;
}

function resolveArtDetailsPt(spec: NailFingerDesignSpec): string[] {
  const details: string[] = [];
  const pushUnique = (item: string | null) => {
    if (item && !details.includes(item)) {
      details.push(item);
    }
  };

  const mSpec = spec.manufacturingSpec;
  if (mSpec) {
    pushUnique(
      resolveBorderDetailPt(mSpec.borderType, mSpec.borderIsMetallic, mSpec.borderIs3DRaised)
    );

    if (mSpec.gradientType === 'vertical_ombre') {
      pushUnique('Gradiente ombré / baby boomer');
    } else if (mSpec.gradientType === 'radial_aura') {
      pushUnique('Gradiente aura central');
    } else if (mSpec.gradientType === 'cat_eye_diagonal') {
      pushUnique('Efeito magnético olho de gato');
    }

    for (const strokeLabel of describeStrokesPt(mSpec.strokes3D)) {
      pushUnique(strokeLabel);
    }

    for (const motif of mSpec.motifs) {
      const base = MOTIF_LABEL_PT[motif.kind] ?? 'Arte decorativa';
      const label =
        motif.is3DRaised && !base.includes('3D') ? `${base} em relevo 3D` : base;
      pushUnique(label);
    }
  } else {
    const bp = spec.blueprint;
    if (bp) {
      const borderMap: Record<string, Nail3DBorderType> = {
        none: 'none',
        full_metallic_outline: 'full_perimeter_outline',
        cuticle_cuff: 'cuticle_cuff',
        classic_french: 'classic_french',
        micro_french: 'micro_french',
        v_french: 'deep_v_french',
      };
      pushUnique(
        resolveBorderDetailPt(
          borderMap[bp.borderLayer.kind] ?? 'none',
          bp.borderLayer.isMetallic,
          bp.borderLayer.is3DRaised
        )
      );
      if (bp.baseLayer.gradientMode === 'vertical_ombre') {
        pushUnique('Gradiente ombré / baby boomer');
      } else if (bp.baseLayer.gradientMode === 'radial_aura') {
        pushUnique('Gradiente aura central');
      }
    }

    if (details.length === 0) {
      if (spec.hasMetallicOutline) pushUnique('Contorno metálico');
      if (spec.pattern === 'french_tip') pushUnique('Francesinha');
      if (spec.pattern === 'gold_3d_waves') pushUnique('Traços dourados em relevo 3D');
      if (spec.pattern === 'aura_gradient') pushUnique('Gradiente / Aura');
      if (spec.pattern === 'floral_accent') pushUnique('Motivo floral');
    }
  }

  return details;
}

function formatAccessoryLabel(acc: Nail3DAccessorySpec): string {
  const base = ACCESSORY_BASE_LABEL_PT[acc.kind] ?? 'Acessório 3D';
  if (acc.kind === 'metal_stud_sphere' || acc.kind === 'metal_stud_flat') {
    const tone = classifyMetallicTonePt(acc.colorHex);
    if (tone) {
      if (acc.kind === 'metal_stud_flat') {
        const mascTone =
          tone === 'Prateada' ? 'Prateado' : tone === 'Dourada' ? 'Dourado' : tone;
        return `${base} ${mascTone}`;
      }
      return `${base} ${tone}`;
    }
  }
  return base;
}

function resolveAccessoriesPt(spec: NailFingerDesignSpec): string[] {
  const counts = new Map<string, number>();
  const accessories = spec.manufacturingSpec?.accessories3D ?? [];

  if (accessories.length > 0) {
    for (const acc of accessories) {
      const label = formatAccessoryLabel(acc);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  } else if (spec.blueprint?.artElements?.length) {
    for (const el of spec.blueprint.artElements) {
      if (el.type !== 'micro_gem') continue;
      const label =
        el.kind === 'pearl'
          ? 'Pérola 3D'
          : el.kind === 'crystal'
            ? 'Strass/Cristal'
            : 'Esfera Metálica Dourada';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([label, qty]) => `${qty}x ${label}`);
}

function resolveSecondaryColorHex(
  spec: NailFingerDesignSpec,
  primaryHex: string
): string | undefined {
  const mSpec = spec.manufacturingSpec;
  const candidates: Array<string | undefined> = [
    mSpec?.secondaryColorHex,
    mSpec && mSpec.borderType !== 'none' ? mSpec.borderColorHex : undefined,
    mSpec && mSpec.gradientType !== 'none' ? mSpec.tipColorHex : undefined,
    spec.secondaryColor,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const hex = normalizeHex(raw, '');
    if (hex.length === 7 && deltaE(primaryHex, hex) > 6) {
      return hex;
    }
  }
  return undefined;
}

function pickMode<T extends string>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;
  const freq = new Map<T, number>();
  let best = values[0];
  let bestCount = 0;
  for (const val of values) {
    const next = (freq.get(val) ?? 0) + 1;
    freq.set(val, next);
    if (next > bestCount) {
      best = val;
      bestCount = next;
    }
  }
  return best;
}

interface FingerCluster {
  repColorHex: string;
  finishLabelPt: string;
  artKey: string;
  accKey: string;
  fingerIds: FingerId[];
}

function detectAccentFingers(
  fingers: Omit<NailTechnicalSheetFinger, 'isAccentFinger'>[]
): Set<FingerId> {
  const clusters: FingerCluster[] = [];

  for (const f of fingers) {
    const artKey = [...f.artDetailsPt].sort().join('|');
    const accKey = [...f.accessoriesPt].sort().join('|');

    const match = clusters.find(
      (c) =>
        c.finishLabelPt === f.finishLabelPt &&
        c.artKey === artKey &&
        c.accKey === accKey &&
        deltaE(c.repColorHex, f.primaryColorHex) <= 14
    );

    if (match) {
      match.fingerIds.push(f.fingerId);
    } else {
      clusters.push({
        repColorHex: f.primaryColorHex,
        finishLabelPt: f.finishLabelPt,
        artKey,
        accKey,
        fingerIds: [f.fingerId],
      });
    }
  }

  if (clusters.length <= 1) {
    return new Set<FingerId>();
  }

  // Largest cluster is the predominant base design; tie-break preferring middle/index/ring
  const priorityOrder: FingerId[] = ['middle', 'index', 'ring', 'pinky', 'thumb'];
  clusters.sort((a, b) => {
    if (b.fingerIds.length !== a.fingerIds.length) {
      return b.fingerIds.length - a.fingerIds.length;
    }
    const rankA = Math.min(...a.fingerIds.map((id) => priorityOrder.indexOf(id)));
    const rankB = Math.min(...b.fingerIds.map((id) => priorityOrder.indexOf(id)));
    return rankA - rankB;
  });

  const predominantSet = new Set<FingerId>(clusters[0].fingerIds);
  const accents = new Set<FingerId>();
  for (const f of fingers) {
    if (!predominantSet.has(f.fingerId)) {
      accents.add(f.fingerId);
    }
  }
  return accents;
}

function buildWhatsappText(params: {
  designName?: string;
  studioName?: string;
  predominantShapePt: string;
  predominantExtensionPt: string;
  summaryPt: string;
  fingers: NailTechnicalSheetFinger[];
}): string {
  const lines: string[] = [];
  const title = params.designName?.trim()
    ? `*FICHA TÉCNICA DE UNHAS — ${params.designName.trim()}*`
    : '*FICHA TÉCNICA DE UNHAS*';

  lines.push(title);
  lines.push(`• Formato: *${params.predominantShapePt}*`);
  lines.push(`• Alongamento: *${params.predominantExtensionPt}*`);
  if (params.summaryPt.trim()) {
    lines.push(`• Resumo: ${params.summaryPt.trim()}`);
  }
  lines.push('');
  lines.push('*Detalhamento Unha por Unha:*');

  for (const finger of params.fingers) {
    const accentTag = finger.isAccentFinger ? ' ★ *Filha Única / Destaque*' : '';
    const colorPart = finger.secondaryColorHex
      ? `${finger.primaryColorHex} + ${finger.secondaryColorHex}`
      : finger.primaryColorHex;
    const extras: string[] = [];
    if (finger.artDetailsPt.length > 0) {
      extras.push(`Arte: ${finger.artDetailsPt.join(', ')}`);
    }
    if (finger.accessoriesPt.length > 0) {
      extras.push(`3D: ${finger.accessoriesPt.join(', ')}`);
    }
    const extrasSuffix = extras.length > 0 ? ` | ${extras.join(' | ')}` : '';
    lines.push(
      `• *${finger.labelPt}*${accentTag}: ${finger.finishLabelPt} (${colorPart}) • ${finger.shapeLabelPt} (${finger.extensionLevelPt})${extrasSuffix}`
    );
  }

  lines.push('');
  const signature = params.studioName?.trim() || 'NailComparer Studio';
  lines.push(`_${signature} — Ficha Técnica Automática_`);

  return lines.join('\n');
}

export function generateNailTechnicalSheet(
  input: GenerateNailTechnicalSheetInput
): NailTechnicalSheet {
  const draftFingers: Array<Omit<NailTechnicalSheetFinger, 'isAccentFinger'>> = [];

  for (const fingerId of ORDERED_FINGERS) {
    const spec =
      input.fingerSpecs[fingerId] ??
      input.fingerSpecs.middle ??
      input.fingerSpecs.ring ??
      input.fingerSpecs.index;

    const shape: NailShape =
      spec?.manufacturingSpec?.shape ?? spec?.shape ?? input.predominantShape ?? 'almond';
    const primaryColorHex = normalizeHex(
      spec?.manufacturingSpec?.trueBaseColorHex ?? spec?.baseColor,
      '#D9C2B4'
    );
    const secondaryColorHex = spec ? resolveSecondaryColorHex(spec, primaryColorHex) : undefined;

    draftFingers.push({
      fingerId,
      labelPt: FINGER_LABEL_PT[fingerId],
      shape,
      shapeLabelPt: SHAPE_LABEL_PT[shape] ?? 'Amendoada',
      extensionLevelPt: spec
        ? formatExtensionLevelPt(spec, input.extensionLevel)
        : input.extensionLevel
          ? normalizeExtensionLabel(input.extensionLevel)
          : 'Pouco Alongada',
      primaryColorHex,
      ...(secondaryColorHex ? { secondaryColorHex } : {}),
      finishLabelPt: spec ? resolveFinishLabelPt(spec) : 'Gel Brilhante',
      artDetailsPt: spec ? resolveArtDetailsPt(spec) : [],
      accessoriesPt: spec ? resolveAccessoriesPt(spec) : [],
    });
  }

  const accentSet = detectAccentFingers(draftFingers);
  const fingers: NailTechnicalSheetFinger[] = draftFingers.map((f) => ({
    ...f,
    isAccentFinger: accentSet.has(f.fingerId),
  }));

  const hasAccentFingers = accentSet.size > 0;
  const predominantShapePt = input.predominantShape
    ? SHAPE_LABEL_PT[input.predominantShape]
    : pickMode(
        fingers.map((f) => f.shapeLabelPt),
        'Amendoada'
      );
  const predominantExtensionPt = input.extensionLevel
    ? normalizeExtensionLabel(input.extensionLevel)
    : pickMode(
        fingers.map((f) => f.extensionLevelPt),
        'Pouco Alongada'
      );

  const predominantFinishPt = pickMode(
    fingers.map((f) => f.finishLabelPt),
    'Gel Brilhante'
  );
  const accentNames = fingers.filter((f) => f.isAccentFinger).map((f) => f.labelPt);

  const autoSummaryPt = hasAccentFingers
    ? `Formato ${predominantShapePt} (${predominantExtensionPt}), acabamento predominante ${predominantFinishPt}, com destaque/filha única em ${accentNames.join(', ')}.`
    : `Formato ${predominantShapePt} (${predominantExtensionPt}) uniforme nas 5 unhas, acabamento ${predominantFinishPt}.`;

  const summaryPt = input.summaryPt?.trim() || autoSummaryPt;
  const whatsappText = buildWhatsappText({
    designName: input.designName,
    studioName: input.studioName,
    predominantShapePt,
    predominantExtensionPt,
    summaryPt,
    fingers,
  });

  return {
    generatedAt: new Date().toISOString(),
    summaryPt,
    predominantShapePt,
    predominantExtensionPt,
    hasAccentFingers,
    fingers,
    whatsappText,
  };
}

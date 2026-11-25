import {
  validateReconstructReferenceDTO,
  type ReconstructReferenceAiResponseDTO,
  type ReconstructReferenceInputDTO,
  type ReconstructReferenceResponseDTO,
  type VisionProvider,
} from '../dtos/VisionDto.js';
import type {
  ArtisticPattern,
  FingerId,
  NailExtensionLevel,
  NailFingerDesignSpec,
  NailFingerSpecsMap,
  NailFinishV9,
  NailShape,
  StrokeAnchor,
} from '../entities/NailDesign.js';
import { AppError, BadRequestError } from './AppError.js';

const ORDERED_FINGERS: readonly FingerId[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
] as const;

const FINGER_DEFAULT_PROPORTIONS: Record<
  FingerId,
  { width: number; length: number }
> = {
  thumb: { width: 1.12, length: 0.94 },
  index: { width: 1.0, length: 1.0 },
  middle: { width: 1.04, length: 1.04 },
  ring: { width: 0.98, length: 1.0 },
  pinky: { width: 0.91, length: 0.91 },
};

const VALID_SHAPES = new Set<string>([
  'natural',
  'oval',
  'almond',
  'coffin',
  'square',
  'stiletto',
]);

const VALID_FINISHES = new Set<string>([
  'glossy_gel',
  'jelly_translucent',
  'chrome_mirror',
  'velvet_matte',
  'cat_eye',
]);

const VALID_PATTERNS = new Set<string>([
  'solid_gloss',
  'chrome_mirror',
  'gold_3d_waves',
  'aura_gradient',
  'french_tip',
  'floral_accent',
]);

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

interface RawVlmFingerSpec {
  shape?: unknown;
  tipRoundness?: unknown;
  extensionMm?: unknown;
  lengthMultiplier?: unknown;
  baseColorHex?: unknown;
  secondaryColorHex?: unknown;
  accentColorHex?: unknown;
  finish?: unknown;
  hasMetallicOutline?: unknown;
  outlineColorHex?: unknown;
  has3DRelief?: unknown;
  reliefDescription?: unknown;
  artDescription?: unknown;
  pattern?: unknown;
  metallicIntensity?: unknown;
  glossIntensity?: unknown;
}

interface RawVlmAnalysis {
  summary?: unknown;
  primaryShape?: unknown;
  primaryLengthMultiplier?: unknown;
  fingers?: Partial<Record<FingerId, RawVlmFingerSpec>>;
}

const VLM_SYSTEM_PROMPT = `You are a master luxury nail technician and 3D computer-vision analyst.
Analyze the uploaded nail design reference photo carefully and produce a strict JSON structural breakdown for all 5 fingers of a single cohesive hand set: thumb, index, middle, ring, pinky.

CRITICAL RULES:
1. If two hands overlap in the photo (e.g., left hand resting on right hand), distinguish the foreground/clearest hand and unify all 5 anatomical finger identities (thumb, index, middle, ring, pinky) without duplicating fingers.
2. Ignore skin, cuticles, rings, bracelets, jewelry, and background surfaces — inspect ONLY the nail plate and free-edge extension.
3. Explicitly detect accent nails ("filha única" or dual accent fingers, commonly ring and/or middle) versus base nails, preserving per-finger art differences (e.g., 3D gold waves, chrome mirror, French tip, aura blush, floral 3D, metallic outline).
4. Estimate true anatomical geometry per finger:
   - shape: "natural" | "oval" | "almond" | "coffin" | "square" | "stiletto"
   - tipRoundness: 0.0 (sharp/flat) to 1.0 (fully rounded)
   - extensionMm: 1.5 to 12.0
   - lengthMultiplier: 0.85 to 1.65 (0.95 = short natural, 1.15 = medium, 1.35 = long, 1.55 = extra long)
5. Output ONLY valid JSON matching the exact schema with 6-digit uppercase hex colors (#RRGGBB).`;

const VLM_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'primaryShape', 'primaryLengthMultiplier', 'fingers'],
  properties: {
    summary: { type: 'string' },
    primaryShape: {
      type: 'string',
      enum: ['natural', 'oval', 'almond', 'coffin', 'square', 'stiletto'],
    },
    primaryLengthMultiplier: { type: 'number' },
    fingers: {
      type: 'object',
      additionalProperties: false,
      required: ['thumb', 'index', 'middle', 'ring', 'pinky'],
      properties: {
        thumb: buildVlmFingerSchema(),
        index: buildVlmFingerSchema(),
        middle: buildVlmFingerSchema(),
        ring: buildVlmFingerSchema(),
        pinky: buildVlmFingerSchema(),
      },
    },
  },
} as const;

function buildVlmFingerSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'shape',
      'tipRoundness',
      'extensionMm',
      'lengthMultiplier',
      'baseColorHex',
      'secondaryColorHex',
      'accentColorHex',
      'finish',
      'hasMetallicOutline',
      'outlineColorHex',
      'has3DRelief',
      'reliefDescription',
      'artDescription',
      'pattern',
      'metallicIntensity',
      'glossIntensity',
    ],
    properties: {
      shape: {
        type: 'string',
        enum: ['natural', 'oval', 'almond', 'coffin', 'square', 'stiletto'],
      },
      tipRoundness: { type: 'number' },
      extensionMm: { type: 'number' },
      lengthMultiplier: { type: 'number' },
      baseColorHex: { type: 'string' },
      secondaryColorHex: { type: 'string' },
      accentColorHex: { type: 'string' },
      finish: {
        type: 'string',
        enum: [
          'glossy_gel',
          'jelly_translucent',
          'chrome_mirror',
          'velvet_matte',
          'cat_eye',
        ],
      },
      hasMetallicOutline: { type: 'boolean' },
      outlineColorHex: { type: 'string' },
      has3DRelief: { type: 'boolean' },
      reliefDescription: { type: 'string' },
      artDescription: { type: 'string' },
      pattern: {
        type: 'string',
        enum: [
          'solid_gloss',
          'chrome_mirror',
          'gold_3d_waves',
          'aura_gradient',
          'french_tip',
          'floral_accent',
        ],
      },
      metallicIntensity: { type: 'number' },
      glossIntensity: { type: 'number' },
    },
  };
}

export class ReferenceVisionService {
  async reconstructReference(
    payload: unknown
  ): Promise<ReconstructReferenceResponseDTO> {
    const validation = validateReconstructReferenceDTO(payload);
    if (!validation.valid) {
      throw new BadRequestError(validation.errors.join(' '), validation.errors);
    }

    const input = validation.data;
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const openaiKey = process.env.OPENAI_API_KEY?.trim();

    if (!geminiKey && !openaiKey) {
      return {
        mode: 'local-fallback-required',
        configured: false,
        reason:
          'No GEMINI_API_KEY or OPENAI_API_KEY configured; client should execute high-res local UV reconstruction.',
      };
    }

    const provider: VisionProvider = geminiKey ? 'gemini' : 'openai';
    const apiKey = (geminiKey || openaiKey) as string;

    const rawAnalysis =
      provider === 'gemini'
        ? await this.analyzeWithGemini(apiKey, input)
        : await this.analyzeWithOpenAI(apiKey, input);

    const fingerSpecs = this.normalizeVlmAnalysisToFingerSpecs(rawAnalysis);

    // Attempt delighted 1024x1024 canonical UV texture synthesis per distinct visual group
    await this.enrichWithCanonicalUvTextures(provider, apiKey, input, fingerSpecs);

    const middleSpec = fingerSpecs.middle;
    const primaryShape = this.normalizeShape(
      rawAnalysis.primaryShape,
      middleSpec.shape
    );
    const primaryLengthMultiplier = this.clampNumber(
      rawAnalysis.primaryLengthMultiplier,
      0.85,
      1.65,
      middleSpec.lengthMultiplier ?? middleSpec.relativeLength
    );

    const summary =
      typeof rawAnalysis.summary === 'string' && rawAnalysis.summary.trim().length > 0
        ? rawAnalysis.summary.trim()
        : `Reconstrução V9 (${provider.toUpperCase()}) concluída para os 5 dedos.`;

    const response: ReconstructReferenceAiResponseDTO = {
      mode: 'ai-vlm',
      configured: true,
      provider,
      fingerSpecs,
      primaryShape,
      primaryLengthMultiplier,
      primaryLength: primaryLengthMultiplier,
      primaryExtensionLevel: this.classifyExtensionLevel(primaryLengthMultiplier),
      primaryBaseColor: middleSpec.baseColor,
      primarySecondaryColor: middleSpec.secondaryColor,
      primaryAccentColor: middleSpec.accentColor,
      primaryPattern: middleSpec.pattern,
      summary,
    };

    return response;
  }

  private async analyzeWithGemini(
    apiKey: string,
    input: ReconstructReferenceInputDTO
  ): Promise<RawVlmAnalysis> {
    const model = process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      systemInstruction: {
        parts: [{ text: VLM_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Analyze all 5 nails (thumb, index, middle, ring, pinky) in this reference image and output strict JSON.',
            },
            {
              inlineData: {
                mimeType: input.mimeType,
                data: input.imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.15,
        responseMimeType: 'application/json',
        responseSchema: VLM_JSON_SCHEMA,
      },
    };

    const res = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      20000
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new AppError(
        502,
        `Falha ao consultar Gemini Vision (${res.status}).`,
        errBody ? [errBody.slice(0, 300)] : undefined
      );
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    if (!text) {
      throw new AppError(502, 'Gemini Vision retornou resposta vazia.');
    }

    return this.safeParseJsonObject<RawVlmAnalysis>(text, 'Gemini Vision');
  }

  private async analyzeWithOpenAI(
    apiKey: string,
    input: ReconstructReferenceInputDTO
  ): Promise<RawVlmAnalysis> {
    const model = process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o-mini';
    const url = 'https://api.openai.com/v1/chat/completions';

    const body = {
      model,
      temperature: 0.15,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'nail_reference_per_finger_analysis',
          strict: true,
          schema: VLM_JSON_SCHEMA,
        },
      },
      messages: [
        { role: 'system', content: VLM_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze all 5 nails (thumb, index, middle, ring, pinky) in this reference image and return strict JSON.',
            },
            {
              type: 'image_url',
              image_url: {
                url: input.imageDataUrl,
                detail: 'high',
              },
            },
          ],
        },
      ],
    };

    const res = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      20000
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new AppError(
        502,
        `Falha ao consultar OpenAI Vision (${res.status}).`,
        errBody ? [errBody.slice(0, 300)] : undefined
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new AppError(502, 'OpenAI Vision retornou resposta vazia.');
    }

    return this.safeParseJsonObject<RawVlmAnalysis>(content, 'OpenAI Vision');
  }

  private async enrichWithCanonicalUvTextures(
    provider: VisionProvider,
    apiKey: string,
    input: ReconstructReferenceInputDTO,
    fingerSpecs: NailFingerSpecsMap
  ): Promise<void> {
    // Group visually identical fingers so we synthesize at most 2 canonical 1024x1024 UV maps
    const groups = new Map<string, FingerId[]>();
    for (const fid of ORDERED_FINGERS) {
      const spec = fingerSpecs[fid];
      const signature = [
        spec.pattern,
        spec.baseColor,
        spec.secondaryColor,
        spec.accentColor,
        spec.finishStyle ?? 'glossy_gel',
        spec.hasMetallicOutline ? spec.outlineColor ?? '1' : '0',
        spec.has3DRelief ? '1' : '0',
      ].join('|');

      const existing = groups.get(signature);
      if (existing) {
        existing.push(fid);
      } else {
        groups.set(signature, [fid]);
      }
    }

    const uniqueGroups = Array.from(groups.values()).slice(0, 3);

    await Promise.all(
      uniqueGroups.map(async (groupFingers) => {
        const representative = fingerSpecs[groupFingers[0]];
        try {
          const uvDataUrl =
            provider === 'gemini'
              ? await this.synthesizeGeminiCanonicalUv(apiKey, input, representative)
              : await this.synthesizeOpenAICanonicalUv(apiKey, representative);

          if (uvDataUrl) {
            for (const fid of groupFingers) {
              fingerSpecs[fid].uvPatchDataUrl = uvDataUrl;
            }
          }
        } catch {
          // Graceful fallback: structural JSON fingerSpecs remain intact if image model fails or times out
        }
      })
    );
  }

  private buildUvTexturePrompt(spec: NailFingerDesignSpec): string {
    return [
      'Generate a square 1024x1024 delighted top-down flat UV nail polish texture swatch filling 100% of the canvas.',
      'STRICT CONSTRAINTS: Zero skin, zero fingers, zero shadows, zero glare highlights, zero background, flat even studio lighting.',
      `Base polish hex: ${spec.baseColor}, secondary/tip/aura hex: ${spec.secondaryColor}, accent/metallic hex: ${spec.accentColor}.`,
      `Pattern: ${spec.pattern}, finish: ${spec.finishStyle ?? 'glossy_gel'}.`,
      spec.hasMetallicOutline
        ? `Include delicate metallic outline border in ${spec.outlineColor ?? spec.accentColor}.`
        : '',
      spec.has3DRelief && spec.reliefDescription
        ? `3D relief motif: ${spec.reliefDescription}.`
        : '',
      spec.artDescription ? `Art details: ${spec.artDescription}.` : '',
      'Cuticle side at bottom edge, free-edge tip at top edge, seamless edges.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  private async synthesizeGeminiCanonicalUv(
    apiKey: string,
    input: ReconstructReferenceInputDTO,
    spec: NailFingerDesignSpec
  ): Promise<string | undefined> {
    const imageModel =
      process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-2.0-flash-exp-image-generation';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      imageModel
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: this.buildUvTexturePrompt(spec) },
            {
              inlineData: {
                mimeType: input.mimeType,
                data: input.imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
      },
    };

    const res = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      7500
    );

    if (!res.ok) {
      return undefined;
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
          }>;
        };
      }>;
    };

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData?.data;
      const mimeType = part.inlineData?.mimeType || 'image/png';
      if (data) {
        return `data:${mimeType};base64,${data}`;
      }
    }
    return undefined;
  }

  private async synthesizeOpenAICanonicalUv(
    apiKey: string,
    spec: NailFingerDesignSpec
  ): Promise<string | undefined> {
    const imageModel = process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1';
    const url = 'https://api.openai.com/v1/images/generations';

    const body = {
      model: imageModel,
      prompt: this.buildUvTexturePrompt(spec),
      size: '1024x1024',
      response_format: 'b64_json',
    };

    const res = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      7500
    );

    if (!res.ok) {
      return undefined;
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string }>;
    };

    const b64 = json.data?.[0]?.b64_json;
    return b64 ? `data:image/png;base64,${b64}` : undefined;
  }

  private normalizeVlmAnalysisToFingerSpecs(
    raw: RawVlmAnalysis
  ): NailFingerSpecsMap {
    const rawFingers = raw.fingers ?? {};
    const fallbackDonor =
      rawFingers.middle ??
      rawFingers.ring ??
      rawFingers.index ??
      rawFingers.thumb ??
      rawFingers.pinky ??
      {};

    const result = {} as NailFingerSpecsMap;

    for (const fingerId of ORDERED_FINGERS) {
      const source = rawFingers[fingerId] ?? fallbackDonor;
      const defaults = FINGER_DEFAULT_PROPORTIONS[fingerId];

      const shape = this.normalizeShape(source.shape, 'almond');
      const lengthMultiplier = this.clampNumber(
        source.lengthMultiplier,
        0.85,
        1.65,
        defaults.length
      );
      const extensionMm = this.clampNumber(
        source.extensionMm,
        1.5,
        12.0,
        Number((2.0 + ((lengthMultiplier - 0.85) / 0.8) * 8.5).toFixed(1))
      );
      const tipRoundness = this.clampNumber(
        source.tipRoundness,
        0,
        1,
        shape === 'square' || shape === 'coffin'
          ? 0.2
          : shape === 'stiletto'
            ? 0.12
            : 0.78
      );

      const pattern = this.normalizePattern(source.pattern, 'solid_gloss');
      const finishStyle = this.normalizeFinishStyle(
        source.finish,
        pattern === 'chrome_mirror' ? 'chrome_mirror' : 'glossy_gel'
      );

      const baseColor = this.sanitizeHexColor(source.baseColorHex, '#E5BEB3');
      const secondaryColor = this.sanitizeHexColor(
        source.secondaryColorHex,
        '#FFFDF9'
      );
      const accentColor = this.sanitizeHexColor(source.accentColorHex, '#D4AF37');
      const hasMetallicOutline = Boolean(source.hasMetallicOutline);
      const outlineColor = hasMetallicOutline
        ? this.sanitizeHexColor(source.outlineColorHex, accentColor)
        : undefined;
      const has3DRelief =
        typeof source.has3DRelief === 'boolean'
          ? source.has3DRelief
          : pattern === 'gold_3d_waves' ||
            pattern === 'floral_accent' ||
            hasMetallicOutline;

      const metallicIntensity = this.clampNumber(
        source.metallicIntensity,
        0,
        1,
        pattern === 'chrome_mirror'
          ? 0.92
          : pattern === 'gold_3d_waves' || hasMetallicOutline
            ? 0.88
            : pattern === 'floral_accent'
              ? 0.45
              : 0.1
      );

      const glossIntensity = this.clampNumber(
        source.glossIntensity,
        0.4,
        1,
        finishStyle === 'velvet_matte' ? 0.56 : 0.95
      );

      result[fingerId] = {
        fingerId,
        detectedFromPhoto: Boolean(rawFingers[fingerId]),
        shape,
        relativeLength: lengthMultiplier,
        lengthMultiplier,
        extensionLevel: this.classifyExtensionLevel(lengthMultiplier),
        extensionMm,
        tipRoundness,
        relativeWidth: defaults.width,
        baseColor,
        secondaryColor,
        accentColor,
        hasMetallicOutline,
        outlineColor,
        has3DRelief,
        reliefDescription:
          typeof source.reliefDescription === 'string' &&
          source.reliefDescription.trim().length > 0
            ? source.reliefDescription.trim()
            : undefined,
        artDescription:
          typeof source.artDescription === 'string' &&
          source.artDescription.trim().length > 0
            ? source.artDescription.trim()
            : undefined,
        finishStyle,
        pattern,
        strokeAnchors: this.defaultAnchorsForPattern(pattern),
        metallicIntensity,
        glossIntensity,
        isImportedReference: true,
      };
    }

    return result;
  }

  private normalizeShape(value: unknown, fallback: NailShape): NailShape {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (VALID_SHAPES.has(normalized)) {
        return normalized as NailShape;
      }
    }
    return fallback;
  }

  private normalizeFinishStyle(
    value: unknown,
    fallback: NailFinishV9
  ): NailFinishV9 {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (VALID_FINISHES.has(normalized)) {
        return normalized as NailFinishV9;
      }
    }
    return fallback;
  }

  private normalizePattern(
    value: unknown,
    fallback: ArtisticPattern
  ): ArtisticPattern {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (VALID_PATTERNS.has(normalized)) {
        return normalized as ArtisticPattern;
      }
    }
    return fallback;
  }

  private sanitizeHexColor(value: unknown, fallback: string): string {
    if (typeof value === 'string') {
      const trimmed = value.trim().toUpperCase();
      if (HEX_COLOR_REGEX.test(trimmed)) {
        return trimmed;
      }
    }
    return fallback;
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number
  ): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number(Math.max(min, Math.min(max, value)).toFixed(2));
    }
    return Number(Math.max(min, Math.min(max, fallback)).toFixed(2));
  }

  private classifyExtensionLevel(lengthMultiplier: number): NailExtensionLevel {
    if (lengthMultiplier <= 1.03) return 'Curta/Natural';
    if (lengthMultiplier <= 1.23) return 'Pouco Alongada';
    if (lengthMultiplier <= 1.45) return 'Alongada';
    return 'Muito Alongada (Extrema)';
  }

  private defaultAnchorsForPattern(pattern: ArtisticPattern): StrokeAnchor[] {
    if (pattern === 'gold_3d_waves') {
      return [
        { u: 0.34, v: 0.34, radius: 0.18, angle: 0.4 },
        { u: 0.62, v: 0.58, radius: 0.2, angle: -0.35 },
        { u: 0.46, v: 0.78, radius: 0.16, angle: 0.25 },
      ];
    }
    if (pattern === 'floral_accent') {
      return [
        { u: 0.44, v: 0.46, radius: 0.14, angle: 0 },
        { u: 0.64, v: 0.68, radius: 0.11, angle: 0.5 },
        { u: 0.32, v: 0.72, radius: 0.1, angle: -0.4 },
      ];
    }
    return [];
  }

  private safeParseJsonObject<T>(rawText: string, providerLabel: string): T {
    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '');
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Not a JSON object');
      }
      return parsed as T;
    } catch {
      throw new AppError(
        502,
        `${providerLabel} retornou JSON estrutural inválido.`
      );
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(
          504,
          'Timeout ao aguardar resposta do provedor de visão computacional.'
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

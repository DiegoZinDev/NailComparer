import type {
  ArtisticPattern,
  FingerId,
  NailExtensionLevel,
  NailFingerSpecsMap,
  NailFinishV9,
  NailShape,
} from '../entities/NailDesign.js';

export type VisionProvider = 'gemini' | 'openai';

export interface ReconstructReferenceInputDTO {
  imageBase64: string;
  mimeType: string;
  imageDataUrl: string;
}

export interface ReconstructReferenceAiResponseDTO {
  mode: 'ai-vlm';
  configured: true;
  provider: VisionProvider;
  fingerSpecs: NailFingerSpecsMap;
  primaryShape: NailShape;
  primaryLengthMultiplier: number;
  primaryLength: number;
  primaryExtensionLevel: NailExtensionLevel;
  primaryBaseColor: string;
  primarySecondaryColor: string;
  primaryAccentColor: string;
  primaryPattern: ArtisticPattern;
  summary: string;
}

export interface ReconstructReferenceFallbackResponseDTO {
  mode: 'local-fallback-required';
  configured: false;
  reason: string;
}

export type ReconstructReferenceResponseDTO =
  | ReconstructReferenceAiResponseDTO
  | ReconstructReferenceFallbackResponseDTO;

export type VisionValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; errors: string[] };

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const DATA_URL_REGEX = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;
const BASE64_REGEX = /^[A-Za-z0-9+/=\s]+$/;

export function validateReconstructReferenceDTO(
  payload: unknown
): VisionValidationResult<ReconstructReferenceInputDTO> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      errors: ['Payload deve ser um objeto JSON válido contendo imageDataUrl ou imageBase64 + mimeType.'],
    };
  }

  const input = payload as Record<string, unknown>;

  if (typeof input.imageDataUrl === 'string' && input.imageDataUrl.trim().length > 0) {
    const trimmed = input.imageDataUrl.trim();
    const match = DATA_URL_REGEX.exec(trimmed);
    if (!match) {
      return {
        valid: false,
        errors: [
          'imageDataUrl inválido. Deve seguir o formato data:image/<tipo>;base64,<dados>.',
        ],
      };
    }

    const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const cleanBase64 = match[2].replace(/\s+/g, '');

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return {
        valid: false,
        errors: [`mimeType "${mimeType}" não suportado para análise de imagem.`],
      };
    }

    if (cleanBase64.length < 32) {
      return {
        valid: false,
        errors: ['imageDataUrl contém dados base64 vazios ou corrompidos.'],
      };
    }

    return {
      valid: true,
      data: {
        imageBase64: cleanBase64,
        mimeType,
        imageDataUrl: `data:${mimeType};base64,${cleanBase64}`,
      },
    };
  }

  if (typeof input.imageBase64 === 'string' && input.imageBase64.trim().length > 0) {
    const rawBase64 = input.imageBase64.trim();

    // Also allow callers passing a data URL inside imageBase64 gracefully
    const embeddedMatch = DATA_URL_REGEX.exec(rawBase64);
    if (embeddedMatch) {
      const mimeType =
        embeddedMatch[1].toLowerCase() === 'image/jpg'
          ? 'image/jpeg'
          : embeddedMatch[1].toLowerCase();
      const cleanBase64 = embeddedMatch[2].replace(/\s+/g, '');
      if (cleanBase64.length < 32) {
        return {
          valid: false,
          errors: ['imageBase64 contém dados vazios ou inválidos.'],
        };
      }
      return {
        valid: true,
        data: {
          imageBase64: cleanBase64,
          mimeType,
          imageDataUrl: `data:${mimeType};base64,${cleanBase64}`,
        },
      };
    }

    if (typeof input.mimeType !== 'string' || input.mimeType.trim().length === 0) {
      return {
        valid: false,
        errors: ['mimeType é obrigatório quando imageBase64 é enviado sem prefixo data URL.'],
      };
    }

    const mimeType =
      input.mimeType.trim().toLowerCase() === 'image/jpg'
        ? 'image/jpeg'
        : input.mimeType.trim().toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return {
        valid: false,
        errors: [`mimeType "${mimeType}" não suportado para análise de imagem.`],
      };
    }

    const cleanBase64 = rawBase64.replace(/\s+/g, '');
    if (cleanBase64.length < 32 || !BASE64_REGEX.test(cleanBase64)) {
      return {
        valid: false,
        errors: ['imageBase64 inválido ou muito curto.'],
      };
    }

    return {
      valid: true,
      data: {
        imageBase64: cleanBase64,
        mimeType,
        imageDataUrl: `data:${mimeType};base64,${cleanBase64}`,
      },
    };
  }

  return {
    valid: false,
    errors: ['imageDataUrl (ou imageBase64 + mimeType) é obrigatório.'],
  };
}

export type VlmFinishToken = NailFinishV9;
export type VlmFingerId = FingerId;

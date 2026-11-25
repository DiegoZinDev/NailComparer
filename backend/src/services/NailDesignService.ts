import crypto from 'node:crypto';
import {
  VALID_NAIL_CATEGORIES,
  isValidNailCategory,
  toNailDesignDTO,
  validateCreateNailDesignDTO,
  validateUpdateNailDesignDTO,
  type NailDesignDTO,
} from '../dtos/NailDesignDto.js';
import type {
  NailCategory,
  NailDesign,
  NailFinish,
  NailPatternType,
} from '../entities/NailDesign.js';
import { NailDesignRepository } from '../repositories/NailDesignRepository.js';
import { BadRequestError, NotFoundError } from './AppError.js';

const CATEGORY_ALIASES: Record<string, NailCategory> = {
  estudio: 'estudio',
  estúdio: 'estudio',
  studio: 'estudio',
  francesinha: 'francesinha',
  gel: 'gel',
  cromado: 'cromado',
  'nail-art': 'nail-art',
  'nail art': 'nail-art',
  nailart: 'nail-art',
  cliente: 'cliente',
};

const FINISH_ALIASES: Record<string, NailFinish> = {
  glossy: 'glossy',
  glossy_gel: 'glossy',
  jelly_translucent: 'glossy',
  chrome: 'chrome',
  chrome_mirror: 'chrome',
  velvet: 'velvet',
  velvet_matte: 'velvet',
  cat_eye: 'velvet',
  glitter: 'glitter',
};

export type NailDesignResponseDTO = NailDesignDTO & {
  isCustom: boolean;
  secondaryColor: string;
  finish: NailFinish;
};

export class NailDesignService {
  private readonly nailDesignRepository: NailDesignRepository;

  constructor(nailDesignRepository = new NailDesignRepository()) {
    this.nailDesignRepository = nailDesignRepository;
  }

  listDesigns(rawCategory?: string): NailDesignResponseDTO[] {
    let category: NailCategory | undefined;

    if (rawCategory !== undefined && rawCategory.trim() !== '') {
      const normalized = this.normalizeCategory(rawCategory);
      if (!normalized) {
        throw new BadRequestError(
          `Categoria inválida "${rawCategory}". Valores aceitos: ${VALID_NAIL_CATEGORIES.join(', ')}.`
        );
      }
      category = normalized;
    }

    const designs = this.nailDesignRepository.findAll(category);
    return designs.map((entity) => this.enrichResponseDto(toNailDesignDTO(entity)));
  }

  getDesignById(id: string): NailDesignResponseDTO {
    const cleanId = id?.trim();
    if (!cleanId) {
      throw new BadRequestError('ID do design é obrigatório.');
    }

    const found = this.nailDesignRepository.findById(cleanId);
    if (!found) {
      throw new NotFoundError(`Design com id "${cleanId}" não encontrado.`);
    }

    return this.enrichResponseDto(toNailDesignDTO(found));
  }

  createDesign(payload: unknown): NailDesignResponseDTO {
    const normalizedPayload = this.normalizeIncomingPayload(payload, false);
    const validation = validateCreateNailDesignDTO(normalizedPayload);

    if (!validation.valid) {
      throw new BadRequestError(validation.errors.join(' '), validation.errors);
    }

    const input = validation.data;
    const generatedId = this.resolveUniqueId(input.id);

    const patternType: NailPatternType =
      input.patternType ?? (input.imageDataUrl ? 'custom-photo' : 'solid');
    const resolvedFinish: NailFinish =
      input.finish ?? this.deriveFinish(patternType);
    const resolvedAccentColor = input.accentColor ?? '#FFFFFF';
    const resolvedSecondaryColor =
      input.secondaryColor !== undefined ? input.secondaryColor : null;

    const entity: NailDesign = {
      id: generatedId,
      name: input.name,
      category: input.category,
      styleType: input.styleType ?? (input.imageDataUrl ? 'image' : 'procedural'),
      baseColor: input.baseColor ?? '#F3D5C0',
      secondaryColor: resolvedSecondaryColor,
      accentColor: resolvedAccentColor,
      finish: resolvedFinish,
      patternType,
      imageDataUrl: input.imageDataUrl ?? null,
      defaultScale: input.defaultScale ?? 1.0,
      defaultRotation: input.defaultRotation ?? 0,
      defaultOpacity: input.defaultOpacity ?? 0.92,
      isCustomReference: input.isCustomReference ?? false,
      isStudioCatalog: input.isStudioCatalog ?? input.category === 'estudio',
      detectedShape: input.detectedShape ?? null,
      detectedLength: input.detectedLength ?? null,
      fingerSpecs: input.fingerSpecs ?? null,
      createdAt: new Date().toISOString(),
    };

    const created = this.nailDesignRepository.create(entity);
    return this.enrichResponseDto(toNailDesignDTO(created));
  }

  updateDesign(id: string, payload: unknown): NailDesignResponseDTO {
    const cleanId = id?.trim();
    if (!cleanId) {
      throw new BadRequestError('ID do design é obrigatório.');
    }

    const existing = this.nailDesignRepository.findById(cleanId);
    if (!existing) {
      throw new NotFoundError(`Design com id "${cleanId}" não encontrado.`);
    }

    const normalizedPayload = this.normalizeIncomingPayload(payload, true);
    const validation = validateUpdateNailDesignDTO(normalizedPayload);

    if (!validation.valid) {
      throw new BadRequestError(validation.errors.join(' '), validation.errors);
    }

    const updates = validation.data;
    const nextStyleType = updates.styleType ?? existing.styleType;
    const nextImageDataUrl =
      updates.imageDataUrl !== undefined ? updates.imageDataUrl : existing.imageDataUrl;

    if (nextStyleType === 'image' && !nextImageDataUrl) {
      throw new BadRequestError(
        'imageDataUrl é obrigatório quando styleType é "image".'
      );
    }

    const updated = this.nailDesignRepository.update(cleanId, updates);
    if (!updated) {
      throw new NotFoundError(`Design com id "${cleanId}" não encontrado.`);
    }

    return this.enrichResponseDto(toNailDesignDTO(updated));
  }

  deleteDesign(id: string): { deleted: true; id: string } {
    const cleanId = id?.trim();
    if (!cleanId) {
      throw new BadRequestError('ID do design é obrigatório.');
    }

    const removed = this.nailDesignRepository.deleteById(cleanId);
    if (!removed) {
      throw new NotFoundError(`Design com id "${cleanId}" não encontrado.`);
    }

    return { deleted: true, id: cleanId };
  }

  private resolveUniqueId(requestedId?: string): string {
    if (!requestedId) {
      return crypto.randomUUID();
    }
    const existing = this.nailDesignRepository.findById(requestedId);
    if (existing) {
      return `${requestedId.slice(0, 42)}-${crypto.randomUUID().slice(0, 8)}`;
    }
    return requestedId;
  }

  private normalizeCategory(value: unknown): NailCategory | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (isValidNailCategory(trimmed)) {
      return trimmed;
    }
    return CATEGORY_ALIASES[trimmed.toLowerCase()];
  }

  private normalizeFinish(value: unknown): NailFinish | undefined {
    if (typeof value !== 'string') return undefined;
    const key = value.trim().toLowerCase();
    return FINISH_ALIASES[key];
  }

  private normalizeIncomingPayload(payload: unknown, isPartial: boolean): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }

    const raw = payload as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...raw };

    if (raw.category !== undefined) {
      const mapped = this.normalizeCategory(raw.category);
      if (mapped) {
        normalized.category = mapped;
      }
    }

    if (raw.finish !== undefined) {
      const mappedFinish = this.normalizeFinish(raw.finish);
      if (mappedFinish) {
        normalized.finish = mappedFinish;
      }
    } else if (!isPartial && raw.patternType !== undefined && typeof raw.patternType === 'string') {
      normalized.finish = this.deriveFinish(raw.patternType as NailPatternType);
    }

    if (normalized.isCustomReference === undefined && typeof raw.isCustom === 'boolean') {
      normalized.isCustomReference = raw.isCustom;
    }

    if (
      normalized.accentColor === undefined &&
      typeof raw.secondaryColor === 'string'
    ) {
      normalized.accentColor = raw.secondaryColor;
    }

    if (!isPartial && raw.imageDataUrl && normalized.styleType === undefined) {
      normalized.styleType = 'image';
    }

    return normalized;
  }

  private enrichResponseDto(dto: NailDesignDTO): NailDesignResponseDTO {
    return {
      ...dto,
      isCustom: dto.isCustomReference,
      secondaryColor: dto.secondaryColor ?? dto.accentColor,
      finish: dto.finish ?? this.deriveFinish(dto.patternType),
    };
  }

  private deriveFinish(patternType: NailPatternType): NailFinish {
    switch (patternType) {
      case 'chrome':
      case 'aurora':
        return 'chrome';
      case 'cat-eye':
        return 'velvet';
      case 'gold-foil':
        return 'glitter';
      default:
        return 'glossy';
    }
  }
}

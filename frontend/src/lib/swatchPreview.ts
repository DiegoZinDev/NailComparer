import type { NailDesign } from '../types/nail';

/**
 * Generates a crisp circular thumbnail data URL or CSS background preview
 * matching the procedural AR nail design so the Magnetic Dock shows exact swatches.
 */
export function getSwatchBackground(design: NailDesign): string {
  if (design.imageDataUrl) {
    return `url("${design.imageDataUrl}") center/cover no-repeat`;
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

export function getStudioMonogram(studioName: string): string {
  const words = studioName
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return 'NA';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { generateNailTechnicalSheet } from '../lib/nailTechnicalSheet';
import type {
  FingerId,
  Nail3DFinishType,
  NailDesign,
  NailFingerDesignSpec,
  NailTechnicalSheet,
} from '../types/nail';

const ORDERED_FINGERS: readonly FingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function mapDesignFinishTo3D(finish: NailDesign['finish']): Nail3DFinishType {
  switch (finish) {
    case 'chrome':
      return 'mirror_chrome';
    case 'velvet':
      return 'velvet_matte';
    case 'glitter':
      return 'glitter_suspension';
    case 'glossy':
    default:
      return 'solid_gloss_gel';
  }
}

/**
 * Resolves the technical sheet for any NailDesign: uses the persisted V14
 * `design.technicalSheet` if available, otherwise generates one on-demand
 * from `design.fingerSpecs` or clean parametric defaults.
 */
export function resolveDesignTechnicalSheet(
  design: NailDesign,
  studioName?: string
): NailTechnicalSheet {
  if (design.technicalSheet && design.technicalSheet.fingers?.length === 5) {
    return design.technicalSheet;
  }

  let fingerSpecs = design.fingerSpecs;
  if (!fingerSpecs) {
    const shape = design.detectedShape ?? 'almond';
    const finishType = mapDesignFinishTo3D(design.finish);
    const built = {} as Record<FingerId, NailFingerDesignSpec>;
    for (const fid of ORDERED_FINGERS) {
      built[fid] = {
        fingerId: fid,
        detectedFromPhoto: false,
        shape,
        relativeLength: design.detectedLength ?? 1.4,
        relativeWidth: 1.0,
        baseColor: design.baseColor,
        secondaryColor: design.secondaryColor ?? design.baseColor,
        accentColor: design.accentColor ?? design.secondaryColor ?? design.baseColor,
        pattern:
          design.patternType === 'french'
            ? 'french_tip'
            : design.patternType === 'chrome'
              ? 'chrome_mirror'
              : design.patternType === 'ombre'
                ? 'aura_gradient'
                : 'solid_gloss',
        strokeAnchors: [],
        metallicIntensity: finishType === 'mirror_chrome' ? 0.94 : 0.08,
        glossIntensity: finishType === 'velvet_matte' ? 0.35 : 0.96,
        renderStrategy: 'procedural_pbr_3d',
        manufacturingSpec: {
          fingerId: fid,
          renderStrategy: 'procedural_pbr_3d',
          shape,
          freeEdgeRatio: Math.max(0.15, (design.detectedLength ?? 1.4) - 1),
          tipRoundness: 0.55,
          cCurveDepth: 0.145,
          apexHeight: 0.058,
          substrateType: 'opaque_gel_polish',
          finishType,
          trueBaseColorHex: design.baseColor,
          secondaryColorHex: design.secondaryColor ?? design.baseColor,
          cuticleColorHex: design.baseColor,
          tipColorHex: design.secondaryColor ?? design.baseColor,
          gradientType: design.patternType === 'ombre' ? 'vertical_ombre' : 'none',
          metalness: finishType === 'mirror_chrome' ? 0.95 : 0.05,
          roughness: finishType === 'velvet_matte' ? 0.44 : 0.08,
          clearcoat: finishType === 'velvet_matte' ? 0.15 : 1.0,
          translucency: 0.08,
          borderType: design.patternType === 'french' ? 'classic_french' : 'none',
          borderColorHex: design.secondaryColor ?? '#FFF9F4',
          borderWidthNorm: 0.08,
          borderIsMetallic: false,
          borderIs3DRaised: false,
          strokes3D: [],
          motifs: [],
          accessories3D: [],
          designNotesPt: design.name,
        },
      };
    }
    fingerSpecs = built;
  }

  return generateNailTechnicalSheet({
    designName: design.name,
    studioName,
    fingerSpecs,
    predominantShape: design.detectedShape,
  });
}

export function buildWhatsappUrl(text: string, studioWhatsapp?: string): string {
  const digits = (studioWhatsapp ?? '').replace(/\D/g, '');
  const encoded = encodeURIComponent(text);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export interface TechnicalSheetCardProps {
  sheet: NailTechnicalSheet;
  studioWhatsapp?: string;
  title?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  compact?: boolean;
  hideActions?: boolean;
}

export const TechnicalSheetCard: React.FC<TechnicalSheetCardProps> = ({
  sheet,
  studioWhatsapp,
  title = 'Ficha Técnica Unha-por-Unha',
  collapsible = false,
  defaultOpen = true,
  compact = false,
  hideActions = false,
}) => {
  const [expanded, setExpanded] = useState<boolean>(defaultOpen);
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = async () => {
    const text = sheet.whatsappText;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const handleOpenWhatsApp = () => {
    const url = buildWhatsappUrl(sheet.whatsappText, studioWhatsapp);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section
      className={`tech-sheet-card ${compact ? 'is-compact' : ''}`}
      aria-label={title}
    >
      <div
        className={`tech-sheet-header ${collapsible ? 'is-clickable' : ''}`}
        onClick={collapsible ? () => setExpanded((prev) => !prev) : undefined}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? expanded : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpanded((prev) => !prev);
                }
              }
            : undefined
        }
      >
        <div className="tech-sheet-title-wrap">
          <span className="tech-sheet-icon" aria-hidden="true">
            <FileText size={14} />
          </span>
          <div className="tech-sheet-heading-text">
            <h3 className="tech-sheet-title">{title}</h3>
            <div className="tech-sheet-summary-pills">
              <span className="tech-sheet-pill is-highlight">{sheet.predominantShapePt}</span>
              <span className="tech-sheet-pill">{sheet.predominantExtensionPt}</span>
              {sheet.hasAccentFingers && (
                <span className="tech-sheet-pill is-accent">
                  <Sparkles size={10} />
                  <span>Filha Única</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {collapsible && (
          <span className="tech-sheet-chevron" aria-hidden="true">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </div>

      {(!collapsible || expanded) && (
        <div className="tech-sheet-body">
          {sheet.summaryPt && <p className="tech-sheet-summary">{sheet.summaryPt}</p>}

          <ul className="tech-sheet-finger-list">
            {sheet.fingers.map((finger) => (
              <li
                key={finger.fingerId}
                className={`tech-sheet-finger-row ${finger.isAccentFinger ? 'is-accent' : ''}`}
              >
                <div className="tech-sheet-finger-main">
                  <div className="tech-sheet-swatch-stack" aria-hidden="true">
                    <span
                      className="tech-sheet-color-dot"
                      style={{ backgroundColor: finger.primaryColorHex }}
                      title={finger.primaryColorHex}
                    />
                    {finger.secondaryColorHex && (
                      <span
                        className="tech-sheet-color-dot is-secondary"
                        style={{ backgroundColor: finger.secondaryColorHex }}
                        title={finger.secondaryColorHex}
                      />
                    )}
                  </div>

                  <div className="tech-sheet-finger-info">
                    <div className="tech-sheet-finger-top">
                      <strong className="tech-sheet-finger-label">{finger.labelPt}</strong>
                      {finger.isAccentFinger && (
                        <span className="tech-sheet-accent-badge">★ Filha Única</span>
                      )}
                      <span className="tech-sheet-finish-pill">{finger.finishLabelPt}</span>
                    </div>

                    <div className="tech-sheet-finger-meta">
                      <span>
                        {finger.shapeLabelPt} • {finger.extensionLevelPt}
                      </span>
                      <span className="tech-sheet-hex">
                        {finger.primaryColorHex}
                        {finger.secondaryColorHex ? ` + ${finger.secondaryColorHex}` : ''}
                      </span>
                    </div>

                    {(finger.artDetailsPt.length > 0 || finger.accessoriesPt.length > 0) && (
                      <div className="tech-sheet-tags">
                        {finger.artDetailsPt.map((art) => (
                          <span key={`art-${art}`} className="tech-sheet-tag">
                            {art}
                          </span>
                        ))}
                        {finger.accessoriesPt.map((acc) => (
                          <span key={`acc-${acc}`} className="tech-sheet-tag is-3d">
                            {acc}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {!hideActions && (
            <div className="tech-sheet-actions">
              <button
                type="button"
                className={`tech-sheet-btn ${copied ? 'is-copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copiada!' : 'Copiar Ficha'}</span>
              </button>
              <button
                type="button"
                className="tech-sheet-btn is-whatsapp"
                onClick={handleOpenWhatsApp}
              >
                <MessageCircle size={14} />
                <span>Enviar no WhatsApp</span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

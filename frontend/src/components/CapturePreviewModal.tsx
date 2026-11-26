import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Download, MessageCircle, X } from 'lucide-react';
import {
  TechnicalSheetCard,
  buildWhatsappUrl,
  resolveDesignTechnicalSheet,
} from './TechnicalSheetCard';
import type { NailDesign, StudioConfig } from '../types/nail';

interface CapturePreviewModalProps {
  imageDataUrl: string | null;
  design: NailDesign;
  config: StudioConfig;
  onClose: () => void;
}

export const CapturePreviewModal: React.FC<CapturePreviewModalProps> = ({
  imageDataUrl,
  design,
  config,
  onClose,
}) => {
  const [includeTechSheet, setIncludeTechSheet] = useState<boolean>(true);

  const technicalSheet = useMemo(
    () => resolveDesignTechnicalSheet(design, config.studioName),
    [design, config.studioName]
  );

  const handleDownload = () => {
    if (!imageDataUrl) return;
    const link = document.createElement('a');
    link.href = imageDataUrl;
    const slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    link.download = `${slug}-nail-ar.png`;
    link.click();
  };

  const handleWhatsAppShare = async () => {
    if (!imageDataUrl) return;

    const intro = `Olá! Adorei o modelo *${design.name}* que testei no provador AR da *${config.studioName}*.`;
    const shareText = includeTechSheet
      ? `${intro}\n\n${technicalSheet.whatsappText}`
      : `${intro} Gostaria de agendar!`;

    // Try Web Share API with image file first (native mobile share sheet -> WhatsApp)
    try {
      const resp = await fetch(imageDataUrl);
      const blob = await resp.blob();
      const file = new File([blob], 'provador-unhas-ar.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: config.studioName,
          text: shareText,
        });
        return;
      }
    } catch {
      // Fallback to WhatsApp deep link + automatic PNG download
    }

    handleDownload();
    const waUrl = buildWhatsappUrl(shareText, config.whatsappNumber);
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <AnimatePresence>
      {imageDataUrl && (
        <motion.div
          key="capture-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-backdrop"
          onClick={onClose}
        >
          <motion.div
            key="capture-sheet"
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 20 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="modal-sheet glass-modal capture-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Foto capturada do provador AR"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">{config.studioName}</span>
                <h2 className="modal-title">{design.name}</h2>
              </div>
              <button
                type="button"
                className="icon-mini-btn"
                onClick={onClose}
                aria-label="Fechar captura"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body capture-modal-body">
              <div className="capture-frame">
                <img src={imageDataUrl} alt={`Provador AR - ${design.name}`} />
              </div>

              <button
                type="button"
                role="checkbox"
                aria-checked={includeTechSheet}
                onClick={() => setIncludeTechSheet((v) => !v)}
                className={`capture-sheet-toggle ${includeTechSheet ? 'is-checked' : ''}`}
              >
                <span className="capture-sheet-checkbox" aria-hidden="true">
                  {includeTechSheet && <Check size={12} />}
                </span>
                <span>Incluir Ficha Técnica Unha-por-Unha ao enviar no WhatsApp</span>
              </button>

              <TechnicalSheetCard
                sheet={technicalSheet}
                studioWhatsapp={config.whatsappNumber}
                title="Ficha Técnica do Modelo"
                collapsible
                defaultOpen={false}
                compact
              />

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={handleDownload}>
                  <Download size={16} />
                  <span>Salvar Foto</span>
                </button>
                <button type="button" className="btn-primary" onClick={handleWhatsAppShare}>
                  <MessageCircle size={16} />
                  <span>Enviar WhatsApp</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

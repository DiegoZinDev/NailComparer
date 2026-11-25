import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, MessageCircle, X } from 'lucide-react';
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

    // Try Web Share API with image file first (native mobile share sheet -> WhatsApp)
    try {
      const resp = await fetch(imageDataUrl);
      const blob = await resp.blob();
      const file = new File([blob], 'provador-unhas-ar.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: config.studioName,
          text: `Olha como ficou "${design.name}" no provador ao vivo da ${config.studioName}!`,
        });
        return;
      }
    } catch {
      // Fallback to WhatsApp deep link + automatic PNG download
    }

    handleDownload();
    const digits = config.whatsappNumber.replace(/\D/g, '');
    const msg = encodeURIComponent(
      `Olá! Adorei o modelo *${design.name}* que testei no provador AR da *${config.studioName}*. Gostaria de agendar!`
    );
    const waUrl = digits
      ? `https://wa.me/${digits}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
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

            <div className="capture-frame">
              <img src={imageDataUrl} alt={`Provador AR - ${design.name}`} />
            </div>

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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

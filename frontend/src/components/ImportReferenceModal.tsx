import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Check, Sparkles, Upload, X } from 'lucide-react';
import { resizeImageToDataUrl } from '../lib/offlineStore';
import type { NailDesign } from '../types/nail';

interface ImportReferenceModalProps {
  open: boolean;
  onClose: () => void;
  onCreateDesign: (design: Omit<NailDesign, 'id' | 'createdAt'>) => Promise<void>;
}

export const ImportReferenceModal: React.FC<ImportReferenceModalProps> = ({
  open,
  onClose,
  onCreateDesign,
}) => {
  const [name, setName] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [finish, setFinish] = useState<NailDesign['finish']>('glossy');
  const [loadingImage, setLoadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setLoadingImage(true);
    try {
      const compressed = await resizeImageToDataUrl(file, 480, 0.88);
      setImageDataUrl(compressed);
      if (!name.trim()) {
        const cleanFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setName(cleanFile.slice(0, 26) || 'Referência da Cliente');
      }
    } catch {
      setError('Não foi possível processar esta imagem. Tente outra foto.');
    } finally {
      setLoadingImage(false);
    }
  };

  const resetAndClose = () => {
    setName('');
    setImageDataUrl(null);
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageDataUrl) {
      setError('Selecione ou fotografe uma referência primeiro.');
      return;
    }
    setSaving(true);
    try {
      await onCreateDesign({
        name: name.trim() || 'Inspiração da Cliente',
        category: 'Cliente',
        patternType: 'solid',
        baseColor: '#D4A383',
        secondaryColor: '#FFFFFF',
        accentColor: '#F3D5C0',
        finish,
        imageDataUrl,
        isCustom: true,
      });
      resetAndClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="import-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-backdrop"
          onClick={resetAndClose}
        >
          <motion.div
            key="import-sheet"
            initial={{ opacity: 0, y: 36, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            className="modal-sheet glass-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">Importar na Hora</span>
                <h2 id="import-title" className="modal-title">
                  Referência da Cliente
                </h2>
              </div>
              <button
                type="button"
                className="icon-mini-btn"
                onClick={resetAndClose}
                aria-label="Fechar importação"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body">
              <div className="import-preview-stage">
                <div className="nail-crop-preview">
                  {imageDataUrl ? (
                    <img src={imageDataUrl} alt="Prévia na unha" />
                  ) : (
                    <div className="nail-crop-placeholder">
                      <Sparkles size={22} />
                      <span>Prévia em Unha</span>
                    </div>
                  )}
                  <div className="nail-crop-gloss" aria-hidden="true" />
                </div>

                <div className="import-upload-buttons">
                  <label className="upload-action-btn">
                    <Upload size={16} />
                    <span>{loadingImage ? 'Processando...' : 'Escolher da Galeria'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFile}
                      className="sr-only"
                    />
                  </label>

                  <label className="upload-action-btn is-secondary">
                    <Camera size={16} />
                    <span>Fotografar Agora</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFile}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              <label className="field-group">
                <span className="field-label">Nome da Inspiração</span>
                <input
                  type="text"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Pinterest Pérola Dourada"
                  className="glass-input"
                />
              </label>

              <div className="field-group">
                <span className="field-label">Acabamento do Brilho AR</span>
                <div className="shape-selector">
                  {(
                    [
                      { id: 'glossy', label: 'Gel Brilho' },
                      { id: 'chrome', label: 'Cromado' },
                      { id: 'velvet', label: 'Veludo' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFinish(item.id)}
                      className={`shape-chip ${finish === item.id ? 'is-active' : ''}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={resetAndClose}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!imageDataUrl || saving}
                >
                  <Check size={16} />
                  <span>{saving ? 'Aplicando...' : 'Provar na Mão'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

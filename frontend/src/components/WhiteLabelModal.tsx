import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  KeyRound,
  Palette,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { DEFAULT_STUDIO_CONFIG, THEME_PRESETS } from '../data/presets';
import { getSavedGeminiApiKey, saveGeminiApiKey } from '../lib/deepNailReconstructor';
import { resizeImageToDataUrl } from '../lib/offlineStore';
import { getStudioMonogram } from '../lib/swatchPreview';
import type { StudioConfig, ThemePresetDefinition } from '../types/nail';

interface WhiteLabelModalProps {
  open: boolean;
  config: StudioConfig;
  onClose: () => void;
  onPreviewChange: (draft: StudioConfig) => void;
  onSave: (finalConfig: StudioConfig) => Promise<void>;
  onOpenStudioCatalogImport?: () => void;
}

export const WhiteLabelModal: React.FC<WhiteLabelModalProps> = ({
  open,
  config,
  onClose,
  onPreviewChange,
  onSave,
  onOpenStudioCatalogImport,
}) => {
  const [draft, setDraft] = useState<StudioConfig>(config);
  const [saving, setSaving] = useState(false);
  const [geminiKey, setGeminiKey] = useState<string>(() => getSavedGeminiApiKey());
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setGeminiKey(getSavedGeminiApiKey());
      setShowGeminiKey(false);
    }
  }, [open, config]);

  const updateDraft = (patch: Partial<StudioConfig>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onPreviewChange(next);
  };

  const applyPreset = (preset: ThemePresetDefinition) => {
    updateDraft({
      themePreset: preset.id,
      primaryColor: preset.primaryColor,
      accentColor: preset.accentColor,
      surfaceColor: preset.surfaceColor,
      onSurfaceColor: preset.onSurfaceColor,
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256, 0.9);
      updateDraft({ logoDataUrl: dataUrl });
    } catch {
      // Ignore unreadable files
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      saveGeminiApiKey(geminiKey);
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    onPreviewChange(config);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="whitelabel-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-backdrop"
          onClick={handleCancel}
        >
          <motion.div
            key="whitelabel-sheet"
            initial={{ opacity: 0, y: 36, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            className="modal-sheet glass-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="whitelabel-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">Motor White-Label</span>
                <h2 id="whitelabel-title" className="modal-title">
                  Identidade do Estúdio
                </h2>
              </div>
              <button
                type="button"
                className="icon-mini-btn"
                onClick={handleCancel}
                aria-label="Fechar configurações"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="modal-body">
              {/* Brand Logo & Studio Name */}
              <div className="brand-upload-row">
                <label className="logo-uploader" title="Enviar logotipo do estúdio">
                  {draft.logoDataUrl ? (
                    <img
                      src={draft.logoDataUrl}
                      alt={draft.studioName}
                      className="logo-preview-img"
                    />
                  ) : (
                    <span className="logo-monogram-preview">
                      {getStudioMonogram(draft.studioName)}
                    </span>
                  )}
                  <span className="logo-badge-icon">
                    <ImagePlus size={13} />
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="sr-only"
                  />
                </label>

                <div className="brand-fields">
                  <label className="field-group">
                    <span className="field-label">Nome do Estúdio</span>
                    <input
                      type="text"
                      value={draft.studioName}
                      maxLength={42}
                      required
                      onChange={(e) => updateDraft({ studioName: e.target.value })}
                      placeholder="Ex: Studio Camila Souza"
                      className="glass-input"
                    />
                  </label>
                  {draft.logoDataUrl && (
                    <button
                      type="button"
                      className="text-link-btn"
                      onClick={() => updateDraft({ logoDataUrl: null })}
                    >
                      Usar monograma ({getStudioMonogram(draft.studioName)})
                    </button>
                  )}
                </div>
              </div>

              <label className="field-group">
                <span className="field-label">WhatsApp do Estúdio (com DDI + DDD)</span>
                <input
                  type="tel"
                  value={draft.whatsappNumber}
                  onChange={(e) =>
                    updateDraft({ whatsappNumber: e.target.value.replace(/[^\d+]/g, '') })
                  }
                  placeholder="5511999999999"
                  className="glass-input"
                />
              </label>

              {/* 4 Instant Theme Presets */}
              <div className="field-group">
                <div className="field-label-row">
                  <span className="field-label">
                    <Sparkles size={13} /> Paletas Instantâneas
                  </span>
                </div>
                <div className="preset-grid">
                  {THEME_PRESETS.map((preset) => {
                    const active = draft.themePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className={`preset-card ${active ? 'is-active' : ''}`}
                      >
                        <div className="preset-swatches">
                          <span
                            className="preset-dot"
                            style={{ background: preset.surfaceColor }}
                          />
                          <span
                            className="preset-dot"
                            style={{ background: preset.primaryColor }}
                          />
                          <span
                            className="preset-dot"
                            style={{ background: preset.accentColor }}
                          />
                        </div>
                        <div className="preset-text">
                          <strong>{preset.name}</strong>
                          <span>{preset.subtitle}</span>
                        </div>
                        {active && (
                          <span className="preset-check">
                            <Check size={13} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Free Color Pickers */}
              <div className="field-group">
                <span className="field-label">
                  <Palette size={13} /> Cores Personalizadas
                </span>
                <div className="color-picker-row">
                  <label className="color-chip-input">
                    <input
                      type="color"
                      value={draft.primaryColor}
                      onChange={(e) =>
                        updateDraft({
                          themePreset: 'custom',
                          primaryColor: e.target.value,
                        })
                      }
                    />
                    <div>
                      <span className="color-name">Primária</span>
                      <code>{draft.primaryColor.toUpperCase()}</code>
                    </div>
                  </label>

                  <label className="color-chip-input">
                    <input
                      type="color"
                      value={draft.accentColor}
                      onChange={(e) =>
                        updateDraft({
                          themePreset: 'custom',
                          accentColor: e.target.value,
                        })
                      }
                    />
                    <div>
                      <span className="color-name">Destaque</span>
                      <code>{draft.accentColor.toUpperCase()}</code>
                    </div>
                  </label>
                </div>
              </div>

              {/* V11 Free Google AI Studio Vision Key (R$ 0,00) */}
              <div className="gemini-key-card">
                <div className="gemini-key-head">
                  <span className="field-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <KeyRound size={13} /> Visão 3D Profunda (Google AI Studio — R$ 0,00)
                  </span>
                  <span
                    className={`gemini-key-status ${geminiKey.trim() ? 'is-configured' : ''}`}
                  >
                    {geminiKey.trim()
                      ? 'Chave local configurada ✓'
                      : 'Usando servidor / offline'}
                  </span>
                </div>

                <div className="gemini-key-input-row">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="Cole sua chave gratuita AIza... (opcional)"
                    className="glass-input"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="icon-mini-btn"
                    onClick={() => setShowGeminiKey((prev) => !prev)}
                    aria-label={showGeminiKey ? 'Ocultar chave' : 'Mostrar chave'}
                  >
                    {showGeminiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                <p className="gemini-key-help">
                  100% gratuita, sem cartão de crédito. Ativa a análise profunda unha-por-unha com
                  auto-verificação visual e acessórios 3D reais.{' '}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gemini-key-link"
                  >
                    <span>Gerar chave gratuita</span>
                    <ExternalLink size={11} />
                  </a>
                </p>
              </div>

              {onOpenStudioCatalogImport && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => {
                    onClose();
                    onOpenStudioCatalogImport();
                  }}
                >
                  <Plus size={15} />
                  <span>Cadastrar Modelo no Catálogo</span>
                </button>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => updateDraft(DEFAULT_STUDIO_CONFIG)}
                >
                  <RotateCcw size={14} />
                  <span>Padrão</span>
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  <Check size={16} />
                  <span>{saving ? 'Aplicando...' : 'Salvar Identidade'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

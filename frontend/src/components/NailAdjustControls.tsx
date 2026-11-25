import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { NailAdjustment } from '../types/nail';

interface NailAdjustControlsProps {
  open: boolean;
  onToggle: () => void;
  adjustment: NailAdjustment;
  onChange: (next: NailAdjustment) => void;
  onReset: () => void;
}

function formatLengthDelta(extensionLength: number): string {
  const pct = Math.round((extensionLength - 1) * 100);
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`;
}

export const NailAdjustControls: React.FC<NailAdjustControlsProps> = ({
  open,
  onToggle,
  adjustment,
  onChange,
  onReset,
}) => {
  return (
    <AnimatePresence>
      {open && (
        <motion.section
          key="adjust-drawer"
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="adjust-drawer glass-panel"
          aria-label="Micro-ajustes técnicos de encaixe anatômico"
        >
          <div className="adjust-header">
            <div className="adjust-title-group">
              <SlidersHorizontal size={15} />
              <span>Encaixe Anatômico</span>
            </div>
            <div className="adjust-header-actions">
              <button
                type="button"
                className="icon-text-btn"
                onClick={onReset}
                title="Restaurar encaixe padrão"
              >
                <RotateCcw size={13} />
                <span>Restaurar encaixe padrão</span>
              </button>
              <button
                type="button"
                className="icon-mini-btn"
                onClick={onToggle}
                aria-label="Fechar ajustes"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          <div className="slider-grid">
            <label className="slider-row">
              <div className="slider-meta">
                <span>Largura de Encaixe</span>
                <span className="slider-val">{adjustment.scale.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.85}
                max={1.2}
                step={0.01}
                value={adjustment.scale}
                onChange={(e) =>
                  onChange({ ...adjustment, scale: parseFloat(e.target.value) })
                }
                className="luxury-range"
              />
            </label>

            <div className="slider-two-col">
              <label className="slider-row">
                <div className="slider-meta">
                  <span>Comprimento Fino (±15%)</span>
                  <span className="slider-val">
                    {formatLengthDelta(adjustment.extensionLength)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.85}
                  max={1.15}
                  step={0.01}
                  value={adjustment.extensionLength}
                  onChange={(e) =>
                    onChange({ ...adjustment, extensionLength: parseFloat(e.target.value) })
                  }
                  className="luxury-range"
                />
              </label>

              <label className="slider-row">
                <div className="slider-meta">
                  <span>Opacidade / Realismo</span>
                  <span className="slider-val">{Math.round(adjustment.opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.7}
                  max={1}
                  step={0.01}
                  value={adjustment.opacity}
                  onChange={(e) =>
                    onChange({ ...adjustment, opacity: parseFloat(e.target.value) })
                  }
                  className="luxury-range"
                />
              </label>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};

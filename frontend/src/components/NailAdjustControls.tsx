import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { NailAdjustment, NailShape } from '../types/nail';

interface NailAdjustControlsProps {
  open: boolean;
  onToggle: () => void;
  adjustment: NailAdjustment;
  onChange: (next: NailAdjustment) => void;
  onReset: () => void;
}

const SHAPES: Array<{ id: NailShape; label: string }> = [
  { id: 'natural', label: 'Natural' },
  { id: 'almond', label: 'Amendoada' },
  { id: 'square', label: 'Quadrada' },
  { id: 'coffin', label: 'Bailarina' },
  { id: 'stiletto', label: 'Stiletto' },
];

function getLengthLabel(len: number): string {
  if (len <= 0.9) return 'Curto';
  if (len <= 1.12) return 'Médio';
  if (len <= 1.42) return 'Longo';
  return 'Extra Longo';
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
          aria-label="Alongamento e formato da unha"
        >
          <div className="adjust-header">
            <div className="adjust-title-group">
              <SlidersHorizontal size={15} />
              <span>Alongamento & Formato</span>
            </div>
            <div className="adjust-header-actions">
              <button
                type="button"
                className="icon-text-btn"
                onClick={onReset}
                title="Restaurar padrão"
              >
                <RotateCcw size={13} />
                <span>Resetar</span>
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

          <div className="shape-selector is-five" role="group" aria-label="Formato do alongamento">
            {SHAPES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onChange({ ...adjustment, shape: s.id })}
                className={`shape-chip ${adjustment.shape === s.id ? 'is-active' : ''}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="slider-grid">
            <label className="slider-row">
              <div className="slider-meta">
                <span>Comprimento do Alongamento</span>
                <span className="slider-val">
                  {getLengthLabel(adjustment.extensionLength)} ({adjustment.extensionLength.toFixed(2)}x)
                </span>
              </div>
              <input
                type="range"
                min={0.75}
                max={1.75}
                step={0.02}
                value={adjustment.extensionLength}
                onChange={(e) =>
                  onChange({ ...adjustment, extensionLength: parseFloat(e.target.value) })
                }
                className="luxury-range"
              />
            </label>

            <div className="slider-two-col">
              <label className="slider-row">
                <div className="slider-meta">
                  <span>Largura</span>
                  <span className="slider-val">{adjustment.scale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.75}
                  max={1.35}
                  step={0.02}
                  value={adjustment.scale}
                  onChange={(e) =>
                    onChange({ ...adjustment, scale: parseFloat(e.target.value) })
                  }
                  className="luxury-range"
                />
              </label>

              <label className="slider-row">
                <div className="slider-meta">
                  <span>Intensidade</span>
                  <span className="slider-val">{Math.round(adjustment.opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.65}
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

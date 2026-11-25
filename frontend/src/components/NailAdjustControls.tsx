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

const SHAPES: Array<{ id: NailAdjustment['shape']; label: string }> = [
  { id: 'almond', label: 'Amendoada' },
  { id: 'oval', label: 'Oval' },
  { id: 'coffin', label: 'Bailarina' },
];

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
          aria-label="Ajustes finos da unha"
        >
          <div className="adjust-header">
            <div className="adjust-title-group">
              <SlidersHorizontal size={15} />
              <span>Ajuste Anatômico</span>
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

          <div className="shape-selector" role="group" aria-label="Formato da unha">
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
                <span>Escala</span>
                <span className="slider-val">{adjustment.scale.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.6}
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
                <span>Rotação</span>
                <span className="slider-val">
                  {adjustment.rotationDeg > 0 ? `+${adjustment.rotationDeg}` : adjustment.rotationDeg}°
                </span>
              </div>
              <input
                type="range"
                min={-45}
                max={45}
                step={1}
                value={adjustment.rotationDeg}
                onChange={(e) =>
                  onChange({ ...adjustment, rotationDeg: parseInt(e.target.value, 10) })
                }
                className="luxury-range"
              />
            </label>

            <label className="slider-row">
              <div className="slider-meta">
                <span>Opacidade</span>
                <span className="slider-val">{Math.round(adjustment.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.35}
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
        </motion.section>
      )}
    </AnimatePresence>
  );
};

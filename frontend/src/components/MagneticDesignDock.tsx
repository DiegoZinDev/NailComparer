import React, { useMemo, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { getSwatchBackground } from '../lib/swatchPreview';
import type { DockTab, NailDesign, NailShape } from '../types/nail';

const TABS: Array<{ id: DockTab; label: string }> = [
  { id: 'client', label: 'Referência da Cliente' },
  { id: 'studio', label: 'Catálogo do Estúdio' },
];

const QUICK_SHAPES: Array<{ id: NailShape; label: string }> = [
  { id: 'natural', label: 'Natural' },
  { id: 'almond', label: 'Amendoada' },
  { id: 'coffin', label: 'Bailarina' },
  { id: 'square', label: 'Quadrada' },
  { id: 'stiletto', label: 'Stiletto' },
];

interface MagneticDesignDockProps {
  designs: NailDesign[];
  activeTab: DockTab;
  onTabChange: (tab: DockTab) => void;
  activeShape: NailShape;
  onShapeChange: (shape: NailShape) => void;
  activeDesignId: string;
  onSelectDesign: (design: NailDesign) => void;
  onOpenImport: () => void;
  onDeleteCustom?: (id: string) => void;
}

interface DockItemProps {
  design: NailDesign;
  isActive: boolean;
  mouseX: ReturnType<typeof useMotionValue<number>>;
  onSelect: () => void;
  onDelete?: () => void;
}

const DockSwatchItem: React.FC<DockItemProps> = ({
  design,
  isActive,
  mouseX,
  onSelect,
  onDelete,
}) => {
  const itemRef = useRef<HTMLButtonElement | null>(null);

  const distance = useTransform(mouseX, (val) => {
    const bounds = itemRef.current?.getBoundingClientRect();
    if (!bounds || val === Infinity) return 160;
    const center = bounds.left + bounds.width / 2;
    return Math.abs(val - center);
  });

  const rawScale = useTransform(distance, [0, 75, 160], [1.18, 1.06, 1]);
  const scale = useSpring(rawScale, { stiffness: 360, damping: 26, mass: 0.5 });

  const swatchBg = useMemo(() => getSwatchBackground(design), [design]);

  return (
    <div className="dock-item-wrap">
      <motion.button
        ref={itemRef}
        type="button"
        onClick={onSelect}
        style={{ scale }}
        whileTap={{ scale: 0.92 }}
        className={`dock-swatch-btn ${isActive ? 'is-active' : ''}`}
        aria-label={design.name}
        aria-pressed={isActive}
      >
        <span className="dock-swatch-circle" style={{ background: swatchBg }} />
        {isActive && (
          <motion.span
            layoutId="dockActiveRing"
            className="dock-active-ring"
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          />
        )}
      </motion.button>
      <span className={`dock-item-label ${isActive ? 'is-active' : ''}`}>
        {design.name}
      </span>
      {design.isCustom && onDelete && isActive && (
        <button
          type="button"
          className="dock-delete-mini"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Remover referência"
          aria-label={`Remover ${design.name}`}
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
};

export const MagneticDesignDock: React.FC<MagneticDesignDockProps> = ({
  designs,
  activeTab,
  onTabChange,
  activeShape,
  onShapeChange,
  activeDesignId,
  onSelectDesign,
  onOpenImport,
  onDeleteCustom,
}) => {
  const mouseX = useMotionValue<number>(Infinity);

  const visibleDesigns = useMemo(() => {
    if (activeTab === 'client') {
      return designs.filter((d) => d.isCustom || d.category === 'Cliente');
    }
    return designs.filter((d) => !d.isCustom && d.category !== 'Cliente');
  }, [designs, activeTab]);

  return (
    <div className="dock-container">
      {/* Discreet 1-Tap Anatomical Shape & Extension Selector above the dock */}
      <div className="quick-shape-strip" role="group" aria-label="Formato do alongamento">
        {QUICK_SHAPES.map((shape) => {
          const isSelected = shape.id === activeShape;
          return (
            <button
              key={shape.id}
              type="button"
              onClick={() => onShapeChange(shape.id)}
              className={`quick-shape-pill ${isSelected ? 'is-active' : ''}`}
            >
              {shape.label}
            </button>
          );
        })}
      </div>

      {/* Clean 2-Tab Switcher (Referência da Cliente / Catálogo do Estúdio) */}
      <div className="dock-tabs-bar" role="tablist" aria-label="Origem das artes">
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.id)}
              className={`dock-tab-btn ${active ? 'is-active' : ''}`}
            >
              {active && (
                <motion.span
                  layoutId="dockTabIndicator"
                  className="dock-tab-bg"
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                />
              )}
              <span className="dock-tab-text">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Floating Luxury Dock with Prominent + Importar Referência CTA */}
      <div
        className="magnetic-dock glass-panel"
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        onTouchMove={(e) => {
          if (e.touches[0]) mouseX.set(e.touches[0].clientX);
        }}
        onTouchEnd={() => mouseX.set(Infinity)}
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={onOpenImport}
          className="dock-import-hero-btn"
          aria-label="Importar foto de referência da cliente"
        >
          <span className="dock-import-hero-icon">
            <Plus size={16} strokeWidth={2.5} />
          </span>
          <span className="dock-import-hero-copy">
            <strong>Importar</strong>
            <small>Referência</small>
          </span>
        </motion.button>

        <div className="dock-divider" aria-hidden="true" />

        <div className="dock-scroll-track">
          {visibleDesigns.length === 0 ? (
            <button type="button" onClick={onOpenImport} className="dock-empty-cta">
              <Camera size={15} />
              <span>Toque para extrair a unha da foto da cliente</span>
            </button>
          ) : (
            visibleDesigns.map((design) => (
              <DockSwatchItem
                key={design.id}
                design={design}
                isActive={design.id === activeDesignId}
                mouseX={mouseX}
                onSelect={() => onSelectDesign(design)}
                onDelete={
                  design.isCustom && onDeleteCustom
                    ? () => onDeleteCustom(design.id)
                    : undefined
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

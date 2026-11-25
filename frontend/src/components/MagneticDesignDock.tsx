import React, { useMemo, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Camera, Plus, Sparkles, Trash2 } from 'lucide-react';
import { getSwatchBackground } from '../lib/swatchPreview';
import type { DockTab, NailDesign } from '../types/nail';

const TABS: Array<{ id: DockTab; label: string }> = [
  { id: 'client', label: 'Referência da Cliente' },
  { id: 'studio', label: 'Catálogo do Estúdio' },
];

interface MagneticDesignDockProps {
  designs: NailDesign[];
  activeTab: DockTab;
  onTabChange: (tab: DockTab) => void;
  activeDesignId: string | null;
  onSelectDesign: (design: NailDesign) => void;
  onOpenImport: (mode: DockTab) => void;
  onDeleteDesign?: (id: string) => void;
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
      {onDelete && (
        <button
          type="button"
          className="dock-delete-mini"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={
            design.isStudioCatalog || design.category === 'Estudio'
              ? 'Remover modelo do catálogo'
              : 'Remover referência'
          }
          aria-label={`Remover ${design.name}`}
          style={{ opacity: isActive ? 1 : 0.72 }}
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
};

export const MagneticDesignDock: React.FC<MagneticDesignDockProps> = ({
  designs,
  activeTab,
  onTabChange,
  activeDesignId,
  onSelectDesign,
  onOpenImport,
  onDeleteDesign,
}) => {
  const mouseX = useMotionValue<number>(Infinity);

  const visibleDesigns = useMemo(() => {
    if (activeTab === 'client') {
      return designs.filter((d) => Boolean(d.isCustom && !d.isStudioCatalog && d.category !== 'Estudio'));
    }
    return designs.filter((d) => Boolean(d.isStudioCatalog || d.category === 'Estudio'));
  }, [designs, activeTab]);

  const isStudioTab = activeTab === 'studio';

  return (
    <div className="dock-container">
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

      {/* Floating Luxury Dock with Contextual Action CTA */}
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
          onClick={() => onOpenImport(activeTab)}
          className="dock-import-hero-btn"
          aria-label={
            isStudioTab
              ? 'Cadastrar modelo no catálogo do estúdio'
              : 'Importar foto de referência da cliente'
          }
        >
          <span className="dock-import-hero-icon">
            <Plus size={16} strokeWidth={2.5} />
          </span>
          <span className="dock-import-hero-copy">
            <strong>{isStudioTab ? 'Cadastrar' : 'Importar'}</strong>
            <small>{isStudioTab ? 'Modelo' : 'Referência'}</small>
          </span>
        </motion.button>

        <div className="dock-divider" aria-hidden="true" />

        <div className="dock-scroll-track">
          {visibleDesigns.length === 0 ? (
            <button
              type="button"
              onClick={() => onOpenImport(activeTab)}
              className="dock-empty-cta"
            >
              {isStudioTab ? <Sparkles size={15} /> : <Camera size={15} />}
              <span>
                {isStudioTab
                  ? 'Cadastrar Modelo no Catálogo do Estúdio'
                  : 'Importar Foto de Referência da Cliente'}
              </span>
            </button>
          ) : (
            visibleDesigns.map((design) => (
              <DockSwatchItem
                key={design.id}
                design={design}
                isActive={design.id === activeDesignId}
                mouseX={mouseX}
                onSelect={() => onSelectDesign(design)}
                onDelete={onDeleteDesign ? () => onDeleteDesign(design.id) : undefined}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Plus, Trash2 } from 'lucide-react';
import { getSwatchBackground } from '../lib/swatchPreview';
import type { NailCategory, NailDesign } from '../types/nail';

const CATEGORIES: NailCategory[] = [
  'Todas',
  'Francesinha',
  'Gel',
  'Cromado',
  'Nail Art',
  'Cliente',
];

interface MagneticDesignDockProps {
  designs: NailDesign[];
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

  const rawScale = useTransform(distance, [0, 75, 160], [1.22, 1.08, 1]);
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
        <span
          className="dock-swatch-circle"
          style={{ background: swatchBg }}
        />
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
  activeDesignId,
  onSelectDesign,
  onOpenImport,
  onDeleteCustom,
}) => {
  const [category, setCategory] = useState<NailCategory>('Todas');
  const mouseX = useMotionValue<number>(Infinity);

  const filteredDesigns = useMemo(() => {
    if (category === 'Todas') return designs;
    return designs.filter((d) => d.category === category);
  }, [designs, category]);

  return (
    <div className="dock-container">
      {/* Category Filter Strip */}
      <div className="category-strip" role="tablist" aria-label="Categorias de unhas">
        {CATEGORIES.map((cat) => {
          const active = cat === category;
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(cat)}
              className={`category-pill ${active ? 'is-active' : ''}`}
            >
              {active && (
                <motion.span
                  layoutId="categoryActiveBg"
                  className="category-pill-bg"
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                />
              )}
              <span className="category-pill-text">{cat}</span>
            </button>
          );
        })}
      </div>

      {/* Floating Magnetic Carousel Dock */}
      <div
        className="magnetic-dock glass-panel"
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        onTouchMove={(e) => {
          if (e.touches[0]) mouseX.set(e.touches[0].clientX);
        }}
        onTouchEnd={() => mouseX.set(Infinity)}
      >
        <div className="dock-import-wrap">
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={onOpenImport}
            className="dock-import-btn"
            aria-label="Importar foto da cliente"
          >
            <Plus size={20} strokeWidth={2.2} />
          </motion.button>
          <span className="dock-item-label">+ Foto</span>
        </div>

        <div className="dock-divider" aria-hidden="true" />

        <div className="dock-scroll-track">
          {filteredDesigns.length === 0 ? (
            <div className="dock-empty-hint">
              Nenhuma referência nesta categoria ainda.
            </div>
          ) : (
            filteredDesigns.map((design) => (
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

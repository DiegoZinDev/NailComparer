import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Camera,
  Download,
  Eye,
  EyeOff,
  Hand,
  RefreshCw,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { ARCameraCanvas, type ARCameraCanvasHandle } from './components/ARCameraCanvas';
import { CapturePreviewModal } from './components/CapturePreviewModal';
import { EditorialTitle } from './components/EditorialTitle';
import { ImportReferenceModal } from './components/ImportReferenceModal';
import { MagneticDesignDock } from './components/MagneticDesignDock';
import { NailAdjustControls } from './components/NailAdjustControls';
import { WhiteLabelModal } from './components/WhiteLabelModal';
import { DEFAULT_STUDIO_CONFIG } from './data/presets';
import {
  type SyncStatus,
  createNailDesign,
  deleteDesign,
  loadNailDesigns,
  loadStudioConfig,
  saveStudioConfig,
} from './lib/offlineStore';
import { getStudioMonogram } from './lib/swatchPreview';
import type {
  ARViewMode,
  DockTab,
  NailAdjustment,
  NailDesign,
  StudioConfig,
} from './types/nail';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DEFAULT_ADJUSTMENT: NailAdjustment = {
  shape: 'natural',
  extensionLength: 1.0,
  scale: 1.0,
  rotationDeg: 0,
  opacity: 0.98,
};

function applyCssVariables(config: StudioConfig): void {
  const root = document.documentElement;
  root.style.setProperty('--primary', config.primaryColor);
  root.style.setProperty('--accent', config.accentColor);
  root.style.setProperty('--surface', config.surfaceColor);
  root.style.setProperty('--on-surface', config.onSurfaceColor);

  const isLightSurface = config.themePreset === 'minimalist-pearl';
  root.style.setProperty(
    '--glass-bg',
    isLightSurface ? 'rgba(247, 245, 242, 0.72)' : 'rgba(16, 13, 15, 0.58)'
  );
  root.style.setProperty(
    '--glass-border',
    isLightSurface ? 'rgba(35, 31, 32, 0.14)' : 'rgba(255, 255, 255, 0.12)'
  );
  root.style.setProperty('--glass-text', isLightSurface ? '#1C191A' : '#FAF5F2');
  root.style.setProperty(
    '--glass-muted',
    isLightSurface ? 'rgba(28, 25, 26, 0.62)' : 'rgba(250, 245, 242, 0.64)'
  );

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', config.surfaceColor);
  }
  document.title = `${config.studioName} — Nail AR Studio`;
}

export function App(): React.ReactElement {
  const arRef = useRef<ARCameraCanvasHandle | null>(null);

  const [config, setConfig] = useState<StudioConfig>(DEFAULT_STUDIO_CONFIG);
  const [designs, setDesigns] = useState<NailDesign[]>([]);
  const [activeTab, setActiveTab] = useState<DockTab>('client');
  const [activeDesignId, setActiveDesignId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');

  const [mode, setMode] = useState<ARViewMode>('studio-demo');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [handDetected, setHandDetected] = useState<boolean>(false);
  const [compareClean, setCompareClean] = useState<boolean>(false);
  const [adjustment, setAdjustment] = useState<NailAdjustment>(DEFAULT_ADJUSTMENT);

  const [adjustOpen, setAdjustOpen] = useState<boolean>(false);
  const [whiteLabelOpen, setWhiteLabelOpen] = useState<boolean>(false);
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importModalMode, setImportModalMode] = useState<'client' | 'studio'>('client');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Capture Android/Chrome native PWA install prompt
  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  // Auto-dismiss transient camera notice
  useEffect(() => {
    if (!cameraNotice) return;
    const timer = window.setTimeout(() => setCameraNotice(null), 5500);
    return () => window.clearTimeout(timer);
  }, [cameraNotice]);

  // Hydrate studio config and real catalog/references with backend -> IndexedDB offline fallback
  useEffect(() => {
    let mounted = true;
    applyCssVariables(DEFAULT_STUDIO_CONFIG);

    Promise.all([loadStudioConfig(), loadNailDesigns()]).then(([cfgRes, desRes]) => {
      if (!mounted) return;
      setConfig(cfgRes.config);
      applyCssVariables(cfgRes.config);
      setDesigns(desRes.designs);
      if (desRes.designs.length > 0) {
        const first = desRes.designs[0];
        setActiveDesignId(first.id);
        setActiveTab(first.isStudioCatalog || first.category === 'Estudio' ? 'studio' : 'client');
        setAdjustment((prev) => ({
          ...prev,
          shape: first.detectedShape ?? 'natural',
          extensionLength: 1.0,
        }));
      } else {
        setActiveDesignId(null);
      }
      setSyncStatus(
        cfgRes.status === 'offline' || desRes.status === 'offline' ? 'offline' : 'synced'
      );
    });

    return () => {
      mounted = false;
    };
  }, []);

  const activeDesign = useMemo<NailDesign | null>(() => {
    if (designs.length === 0 || !activeDesignId) return null;
    return designs.find((d) => d.id === activeDesignId) ?? null;
  }, [designs, activeDesignId]);

  const syncAdjustmentForDesign = useCallback((design: NailDesign) => {
    setAdjustment((prev) => ({
      ...prev,
      shape: design.detectedShape ?? 'natural',
      extensionLength: 1.0,
    }));
  }, []);

  const openImportModal = useCallback((targetMode: 'client' | 'studio') => {
    setImportModalMode(targetMode);
    setImportOpen(true);
  }, []);

  const handleSaveConfig = async (nextConfig: StudioConfig) => {
    setConfig(nextConfig);
    applyCssVariables(nextConfig);
    const res = await saveStudioConfig(nextConfig);
    setConfig(res.config);
    applyCssVariables(res.config);
    setSyncStatus(res.status);
  };

  const handleCreateDesign = async (draft: Omit<NailDesign, 'id' | 'createdAt'>) => {
    const res = await createNailDesign(draft);
    const isStudio = Boolean(
      draft.isStudioCatalog ?? (draft.category === 'Estudio' || importModalMode === 'studio')
    );
    const created: NailDesign = {
      ...res.design,
      fingerSpecs: draft.fingerSpecs ?? res.design.fingerSpecs,
      secondaryColor: draft.secondaryColor ?? res.design.secondaryColor,
      detectedShape: draft.detectedShape ?? res.design.detectedShape,
      detectedLength: draft.detectedLength ?? res.design.detectedLength,
      isStudioCatalog: isStudio,
      isCustom: !isStudio,
      category: isStudio ? 'Estudio' : 'Cliente',
    };
    setDesigns((prev) => [created, ...prev.filter((d) => d.id !== created.id)]);
    setActiveDesignId(created.id);
    syncAdjustmentForDesign(created);
    setActiveTab(isStudio ? 'studio' : 'client');
    setCompareClean(false);
    setSyncStatus(res.status);
  };

  const handleDeleteDesign = async (id: string) => {
    const nextList = designs.filter((d) => d.id !== id);
    setDesigns(nextList);
    if (activeDesignId === id) {
      const nextDesign = nextList[0] ?? null;
      setActiveDesignId(nextDesign ? nextDesign.id : null);
      if (nextDesign) {
        syncAdjustmentForDesign(nextDesign);
      } else {
        setAdjustment(DEFAULT_ADJUSTMENT);
      }
    }
    const status = await deleteDesign(id);
    setSyncStatus(status);
  };

  const handleCapture = useCallback(() => {
    if (!activeDesign) return;
    const dataUrl = arRef.current?.captureCompositeDataUrl(
      config.studioName,
      config.logoDataUrl
    );
    if (dataUrl) {
      setCapturedImage(dataUrl);
    }
  }, [activeDesign, config.studioName, config.logoDataUrl]);

  const toggleMode = useCallback(() => {
    setCameraNotice(null);
    setMode((prev) => (prev === 'studio-demo' ? 'camera' : 'studio-demo'));
  }, []);

  const handleInstallPwa = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  const arCanvasExtraProps = {
    onRequestImportClient: () => openImportModal('client'),
    onRequestImportStudio: () => openImportModal('studio'),
  };

  return (
    <main className="studio-shell">
      {/* 100dvh Full-Bleed Live AR Viewport */}
      <ARCameraCanvas
        ref={arRef}
        mode={mode}
        onModeChange={setMode}
        facingMode={facingMode}
        activeDesign={activeDesign as NailDesign}
        adjustment={adjustment}
        compareClean={compareClean}
        onTrackingChange={setHandDetected}
        onCameraNotice={setCameraNotice}
        {...arCanvasExtraProps}
      />

      {/* Top Floating White-Label Brand Header */}
      <header className="top-hud">
        <div className="brand-pill glass-panel">
          <div className="brand-avatar">
            {config.logoDataUrl ? (
              <img src={config.logoDataUrl} alt={config.studioName} />
            ) : (
              <span>{getStudioMonogram(config.studioName)}</span>
            )}
          </div>
          <div className="brand-copy">
            <h1 className="brand-name">{config.studioName}</h1>
            <div className="brand-subrow">
              <span
                className={`sync-dot ${syncStatus === 'offline' ? 'is-offline' : ''}`}
                title={syncStatus === 'offline' ? 'Modo Offline Local' : 'Sincronizado'}
              />
              <EditorialTitle
                text={activeDesign ? activeDesign.name : 'Sem modelo ativo • Importe uma foto'}
                className="active-design-caption"
              />
            </div>
          </div>
        </div>

        <div className="top-actions">
          {installPrompt && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={handleInstallPwa}
              className="mode-toggle-btn glass-panel"
              title="Instalar App no Android (PWA)"
            >
              <Download size={14} />
              <span>Instalar</span>
            </motion.button>
          )}

          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={toggleMode}
            className={`mode-toggle-btn glass-panel ${mode === 'camera' ? 'is-live' : ''}`}
            title={
              mode === 'camera'
                ? 'Trocar para Mão Modelo (Demo)'
                : 'Ativar Câmera Ao Vivo (AR)'
            }
          >
            {mode === 'camera' ? <Hand size={15} /> : <Camera size={15} />}
            <span>{mode === 'camera' ? 'Mão Modelo' : 'Câmera AR'}</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => setWhiteLabelOpen(true)}
            className="glass-icon-btn glass-panel"
            aria-label="Personalizar estúdio (White-Label)"
            title="Identidade do Estúdio"
          >
            <Settings size={18} />
          </motion.button>
        </div>
      </header>

      {/* Subtle Contextual AR Hint when Camera is active and waiting for hand */}
      {cameraNotice ? (
        <div className="hand-guide-pill glass-panel" role="status">
          <span>{cameraNotice}</span>
        </div>
      ) : (
        mode === 'camera' &&
        !handDetected && (
          <div className="hand-guide-pill glass-panel">
            <span>Posicione a mão aberta diante da câmera</span>
          </div>
        )
      )}

      {/* Right Floating Quick Utility Rail */}
      <div className="side-rail">
        {mode === 'camera' && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() =>
              setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
            }
            className="glass-icon-btn glass-panel"
            aria-label="Alternar câmera frontal ou traseira"
            title="Alternar Câmera"
          >
            <RefreshCw size={17} />
          </motion.button>
        )}

        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onPointerDown={() => setCompareClean(true)}
          onPointerUp={() => setCompareClean(false)}
          onPointerLeave={() => setCompareClean(false)}
          onClick={() => setCompareClean((v) => !v)}
          className={`glass-icon-btn glass-panel ${compareClean ? 'is-highlighted' : ''}`}
          aria-label="Comparar antes e depois"
          title="Antes / Depois"
          disabled={!activeDesign}
          style={!activeDesign ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          {compareClean ? <EyeOff size={17} /> : <Eye size={17} />}
        </motion.button>

        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={() => setAdjustOpen((v) => !v)}
          className={`glass-icon-btn glass-panel ${adjustOpen ? 'is-highlighted' : ''}`}
          aria-label="Ajustar encaixe anatômico"
          title="Encaixe Anatômico"
        >
          <SlidersHorizontal size={17} />
        </motion.button>

        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={handleCapture}
          className="capture-fab"
          aria-label="Capturar foto e enviar no WhatsApp"
          title={activeDesign ? 'Capturar Foto' : 'Selecione ou importe um modelo primeiro'}
          disabled={!activeDesign}
          style={!activeDesign ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          <Camera size={20} />
        </motion.button>
      </div>

      {/* Bottom Floating Controls Stack */}
      <div className="bottom-hud">
        <NailAdjustControls
          open={adjustOpen}
          onToggle={() => setAdjustOpen(false)}
          adjustment={adjustment}
          onChange={setAdjustment}
          onReset={() =>
            setAdjustment({
              ...DEFAULT_ADJUSTMENT,
              shape: activeDesign?.detectedShape ?? 'natural',
            })
          }
        />

        <MagneticDesignDock
          designs={designs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeDesignId={activeDesign?.id ?? null}
          onSelectDesign={(d) => {
            setCompareClean(false);
            setActiveDesignId(d.id);
            syncAdjustmentForDesign(d);
          }}
          onOpenImport={openImportModal}
          onDeleteDesign={handleDeleteDesign}
        />
      </div>

      {/* Modals */}
      <WhiteLabelModal
        open={whiteLabelOpen}
        config={config}
        onClose={() => setWhiteLabelOpen(false)}
        onPreviewChange={applyCssVariables}
        onSave={handleSaveConfig}
        onOpenStudioCatalogImport={() => openImportModal('studio')}
      />

      <ImportReferenceModal
        open={importOpen}
        targetMode={importModalMode}
        onClose={() => setImportOpen(false)}
        onCreateDesign={handleCreateDesign}
      />

      {activeDesign && (
        <CapturePreviewModal
          imageDataUrl={capturedImage}
          design={activeDesign}
          config={config}
          onClose={() => setCapturedImage(null)}
        />
      )}
    </main>
  );
}

export default App;

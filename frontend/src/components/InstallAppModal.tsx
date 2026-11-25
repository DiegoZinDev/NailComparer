import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Download,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
  X,
} from 'lucide-react';

interface InstallAppModalProps {
  open: boolean;
  hasNativePrompt: boolean;
  onTriggerNativeInstall: () => void | Promise<void>;
  onClose: () => void;
}

type InstallPlatform = 'ios' | 'android' | 'desktop';

function detectPlatform(): { platform: InstallPlatform; isInAppBrowser: boolean } {
  if (typeof navigator === 'undefined') {
    return { platform: 'desktop', isInAppBrowser: false };
  }
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isInAppBrowser = /Instagram|FBAN|FBAV|TikTok|WhatsApp|Line\//i.test(ua);

  if (isIOS) return { platform: 'ios', isInAppBrowser };
  if (isAndroid) return { platform: 'android', isInAppBrowser };
  return { platform: 'desktop', isInAppBrowser };
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({
  open,
  hasNativePrompt,
  onTriggerNativeInstall,
  onClose,
}) => {
  const { platform, isInAppBrowser } = useMemo(() => detectPlatform(), []);

  const platformLabel =
    platform === 'ios'
      ? 'iPhone / iPad (Safari)'
      : platform === 'android'
        ? 'Android (Chrome / Edge)'
        : 'Navegador Desktop (Chrome / Edge)';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="install-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-backdrop"
          onClick={onClose}
        >
          <motion.div
            key="install-sheet"
            initial={{ opacity: 0, y: 36, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            className="modal-sheet glass-modal install-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-app-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">Experiência PWA Offline-First</span>
                <h2 id="install-app-title" className="modal-title">
                  Instalar Aplicativo
                </h2>
              </div>
              <button
                type="button"
                className="icon-mini-btn"
                onClick={onClose}
                aria-label="Fechar instruções de instalação"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="install-platform-pill">
                <span className="install-platform-icon">
                  <Smartphone size={17} />
                </span>
                <div className="install-platform-copy">
                  <strong>{platformLabel}</strong>
                  <span>Acesso em tela cheia na tela inicial, mesmo sem 4G.</span>
                </div>
              </div>

              {hasNativePrompt && (
                <button
                  type="button"
                  className="btn-primary install-native-cta"
                  onClick={onTriggerNativeInstall}
                >
                  <Download size={16} />
                  <span>Instalar Agora em 1 Toque</span>
                </button>
              )}

              {platform === 'ios' ? (
                <ol className="install-steps-list">
                  <li className="install-step-card">
                    <span className="install-step-num">1</span>
                    <span className="install-step-icon" aria-hidden="true">
                      <Share size={18} />
                    </span>
                    <div className="install-step-text">
                      <strong>Toque em Compartilhar</strong>
                      <span>
                        Toque no ícone <strong>Compartilhar</strong> na barra inferior do Safari.
                      </span>
                    </div>
                  </li>

                  <li className="install-step-card">
                    <span className="install-step-num">2</span>
                    <span className="install-step-icon" aria-hidden="true">
                      <PlusSquare size={18} />
                    </span>
                    <div className="install-step-text">
                      <strong>Adicionar à Tela de Início</strong>
                      <span>
                        Role e toque em <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>{' '}
                        &rarr; <strong>&ldquo;Adicionar&rdquo;</strong>.
                      </span>
                    </div>
                  </li>
                </ol>
              ) : platform === 'android' ? (
                <ol className="install-steps-list">
                  <li className="install-step-card">
                    <span className="install-step-num">1</span>
                    <span className="install-step-icon" aria-hidden="true">
                      <MoreVertical size={18} />
                    </span>
                    <div className="install-step-text">
                      <strong>Abra o menu do navegador</strong>
                      <span>
                        Toque no menu <strong>&#8942;</strong> no canto superior direito do
                        navegador.
                      </span>
                    </div>
                  </li>

                  <li className="install-step-card">
                    <span className="install-step-num">2</span>
                    <span className="install-step-icon" aria-hidden="true">
                      <Download size={18} />
                    </span>
                    <div className="install-step-text">
                      <strong>Instalar aplicativo</strong>
                      <span>
                        Toque em <strong>&ldquo;Instalar aplicativo&rdquo;</strong> (ou{' '}
                        <strong>&ldquo;Adicionar à tela inicial&rdquo;</strong>).
                      </span>
                    </div>
                  </li>
                </ol>
              ) : (
                <ol className="install-steps-list">
                  <li className="install-step-card">
                    <span className="install-step-num">1</span>
                    <span className="install-step-icon" aria-hidden="true">
                      <MoreVertical size={18} />
                    </span>
                    <div className="install-step-text">
                      <strong>Menu ou barra de endereço</strong>
                      <span>
                        Clique no ícone de instalação na barra de URL ou no menu{' '}
                        <strong>&#8942;</strong> no canto superior direito.
                      </span>
                    </div>
                  </li>

                  <li className="install-step-card">
                    <span className="install-step-num">2</span>
                    <span className="install-step-icon" aria-hidden="true">
                      <Download size={18} />
                    </span>
                    <div className="install-step-text">
                      <strong>Confirmar instalação</strong>
                      <span>
                        Selecione <strong>&ldquo;Instalar aplicativo&rdquo;</strong> para abrir o
                        estúdio como app independente.
                      </span>
                    </div>
                  </li>
                </ol>
              )}

              {isInAppBrowser && (
                <div className="extractor-status-note">
                  Se estiver abrindo pelo Instagram ou WhatsApp, toque em &ldquo;Abrir no{' '}
                  {platform === 'ios' ? 'Safari' : 'Chrome'}&rdquo; antes de instalar.
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className={hasNativePrompt ? 'btn-secondary' : 'btn-primary'}
                  onClick={onClose}
                  style={hasNativePrompt ? { width: '100%' } : undefined}
                >
                  Entendi
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

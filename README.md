# Nail AR Studio (`NailComparer`)

Provador virtual de unhas em **Realidade Aumentada (AR) ao vivo a 60fps** em formato **PWA Mobile-First** com estética **Luxury Beauty Tech** e motor **White-Label** instantâneo para nail designers, esmalterias e estúdios de beleza.

---

## 1. Visão Geral & Proposta Comercial (Luxury Beauty Tech PWA)

O **Nail AR Studio** elimina a indecisão da cliente na cadeira de atendimento e eleva a taxa de conversão de serviços premium (alongamento em gel, cromados, nail art autoral e francesinhas). Em vez de depender apenas de catálogos estáticos em papel ou fotos de terceiros, o estúdio oferece um **espelho digital interativo** diretamente no celular ou tablet:

- **Viewport Full-Bleed (`100dvh`)**: Câmera ou mão modelo ocupando 100% da tela com HUD flutuante em glassmorphism translúcido.
- **Experiência White-Label Pronta para Venda B2B**: Cada estúdio personaliza nome, WhatsApp, logotipo/monograma e paleta visual em tempo real, transformando o aplicativo em produto próprio da marca.
- **Zero Atrito & Offline-First**: Instalável como PWA (`manifest.webmanifest` + `sw.js`) e totalmente funcional mesmo sem internet no estúdio graças ao fallback automático em `IndexedDB` e `localStorage`.

---

## 2. Motor AR 60fps com MediaPipe Hands + Modo Mão Modelo

O componente `frontend/src/components/ARCameraCanvas.tsx` coordena o pipeline gráfico em HTML5 Canvas (`requestAnimationFrame` a 60fps) combinado ao rastreamento anatômico de mãos via `@mediapipe/tasks-vision` (`HandLandmarker`):

- **Detecção em Tempo Real (21 Landmarks)**: Mapeia ponta (`tip`) e articulação distal/intermediária (`dip` / `pip`) dos 5 dedos (`MEDIAPIPE_FINGER_PAIRS`), calculando ângulo, largura e comprimento proporcional de cada lâmina ungueal.
- **Suavização Temporal (EMA)**: Fator `SMOOTHING_ALPHA = 0.42` para eliminar micro-tremores da câmera e manter as unhas virtuais ancoradas com fluidez.
- **Ajustes ao Vivo (`NailAdjustControls`)**: Controle em tempo real de escala, rotação, opacidade e formato de ponta (ex.: `almond`), além de botão **Antes / Depois** (segurar/alternar para comparar a unha natural vs. aplicada).
- **Modo Mão Modelo (`/hand-demo.png`)**: Modo estúdio imediato (`studio-demo`) que renderiza o catálogo sobre uma mão modelo fotográfica de alta definição (`DEMO_HAND_POSES`) — garantindo demonstração instantânea em desktop, ambientes sem câmera ou fallback gracioso quando a permissão WebRTC/WASM não está disponível.
- **Alternância de Câmera**: Suporte a câmera traseira (`environment`) e frontal (`user`, com espelhamento horizontal automático).

---

## 3. Arquitetura em Camadas no Backend (Clean / Spring-Style)

O servidor (`backend/src/`) segue separação estrita de responsabilidades inspirada em **Spring Boot / Clean Architecture**, utilizando Node.js + Express + TypeScript:

```text
backend/src/
├── controllers/   # Camada HTTP (Request/Response + delegação para Services)
│   ├── HealthController.ts
│   ├── StudioConfigController.ts
│   └── NailDesignController.ts
├── services/      # Regras de negócio, validação de DTOs, enriquecimento e AppError
│   ├── AppError.ts
│   ├── StudioConfigService.ts
│   └── NailDesignService.ts
├── repositories/  # Único ponto autorizado a executar SQL via node:sqlite
│   ├── StudioConfigRepository.ts
│   └── NailDesignRepository.ts
├── entities/      # Modelos de domínio e mapeadores Row -> Entity
│   ├── StudioConfig.ts
│   └── NailDesign.ts
├── dtos/          # Contratos de entrada/saída e validadores puros
│   ├── StudioConfigDto.ts
│   └── NailDesignDto.ts
├── db/            # Conexão SQLite (WAL), DDL de migração e Seed idempotente
│   ├── database.ts
│   └── seed.ts
├── routes/        # Roteamento REST (/api/*)
│   └── apiRoutes.ts
├── app.ts         # Middlewares, API, static serving de frontend/dist e error handler
└── index.ts       # Bootstrap do servidor (porta padrão 3001) e graceful shutdown
```

- **Regra de Isolamento SQL**: Nenhuma query SQL (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`) existe em `controllers/` ou `services/`; toda persistência é encapsulada em `repositories/` e `db/`.
- **Serving Unificado em Produção**: Quando `frontend/dist/` está compilado, o backend Express serve os assets estáticos e fallback SPA diretamente na mesma origem (`http://localhost:3001`).

---

## 4. Banco `node:sqlite` & 10 Seeds de Unhas

O banco relacional embarcado utiliza o módulo nativo `node:sqlite` (`DatabaseSync`) em `backend/data/nail-studio.sqlite` com `PRAGMA journal_mode = WAL` e `PRAGMA foreign_keys = ON`.

- **Tabelas**:
  - `studio_config` (`id = 1` singleton): nome do estúdio, WhatsApp, `logo_data_url`, `theme_preset`, `primary_color`, `accent_color`, `surface_color`, `updated_at`.
  - `nail_designs`: catálogo de modelos procedurais e referências personalizadas (`id`, `name`, `category`, `style_type`, `base_color`, `accent_color`, `pattern_type`, `image_data_url`, `default_scale`, `default_rotation`, `default_opacity`, `is_custom_reference`, `created_at`).
- **Seed Idempotente (`backend/src/db/seed.ts`)**: Executado automaticamente no startup (`startServer()`) e via `npm run seed`. Popula a configuração padrão **`Atelier Lumière Nails`** e **10 designs iniciais** cobrindo todas as técnicas:
  1. `francesinha-perolada` — Francesinha Clássica Perolada
  2. `baby-boomer-rose` — Baby Boomer Rosé
  3. `glazed-donut-cromado` — Glazed Donut Cromado
  4. `vermelho-valentino` — Vermelho Valentino Gloss
  5. `nude-leitoso` — Nude Leitoso Minimalista
  6. `francesinha-dourada` — Francesinha Dourada Luxo
  7. `lilas-aurora` — Lilás Pastel Aurora
  8. `onix-folha-ouro` — Preto Ônix + Folha de Ouro
  9. `marmore-quartzo` — Mármore Quartzo Rosa
  10. `cat-eye-champagne` — Cat Eye Magnético Champagne

---

## 5. Motor White-Label Instantâneo

Disponível pelo botão de engrenagem no HUD superior (`frontend/src/components/WhiteLabelModal.tsx`), permitindo customização ao vivo com preview imediato via variáveis CSS (`--primary`, `--accent`, `--surface`, `--on-surface`, `--glass-*`):

- **4 Presets Editoriais**:
  1. **Rose Gold & Nude** (`rose-gold`) — `#D4A383` / `#F3D5C0` sobre `#171214`
  2. **Obsidian & Gold** (`obsidian-gold`) — `#D4AF37` / `#F5E1A4` sobre `#0B0B0D`
  3. **Minimalist Pearl** (`minimalist-pearl`) — `#231F20` / `#B89F8D` sobre `#F7F5F2` (modo claro boutique)
  4. **Soft Lilac** (`soft-lilac`) — `#B997D6` / `#E5D4F2` sobre `#15111B`
- **Color Picker Livre**: Seletores nativos para cor primária e cor de destaque (alternando automaticamente o preset para `custom`).
- **Logo ou Monograma Automático**: Upload de imagem redimensionada client-side (`resizeImageToDataUrl`, até 256px) ou geração automática de monograma a partir do nome do estúdio (`getStudioMonogram`).
- **WhatsApp & Marca d'Água**: Atualização do número do estúdio utilizado no compartilhamento direto e na assinatura das capturas.

---

## 6. Importação de Foto da Cliente & Captura WhatsApp

- **Importar na Hora (`ImportReferenceModal.tsx`)**: A cliente pode trazer uma inspiração do Pinterest/Instagram (upload da galeria ou câmera instantânea com `capture="environment"`). A foto é comprimida no cliente (`480px`), recebe acabamento AR selecionável (`Gel Brilho`, `Cromado`, `Veludo`), é salva na categoria `cliente` via `POST /api/designs` (com fallback local) e aplicada imediatamente nas unhas virtuais.
- **Captura com Marca d'Água & Envio WhatsApp (`CapturePreviewModal.tsx`)**: Gera um PNG composto da mão com as unhas aplicadas + selo editorial do estúdio (nome, logotipo circular e design testado). Suporta `navigator.share` nativo com arquivo no mobile ou download automático + deep link `https://wa.me/{whatsapp}?text=...` pronto para agendamento.

---

## 7. PWA Instalável no Android, Empacotamento `.apk` & Resiliência Offline

- **Configuração `vite-plugin-pwa` + Workbox (`frontend/vite.config.ts`)**: Gera automaticamente o manifesto oficial (`manifest.webmanifest`) e o Service Worker Workbox (`sw.js`) com registro `autoUpdate` via `virtual:pwa-register`, pré-cache dos assets estáticos e runtime caching dedicado para módulos WASM/modelo do MediaPipe Hands (`CacheFirst`), Google Fonts (`CacheFirst`) e API `/api/*` (`NetworkFirst`).
- **Web App Manifest & Ícones Oficiais (`frontend/public/icons/`)**: Configurado com `display: "standalone"`, `display_override: ["standalone", "fullscreen"]`, `orientation: "portrait"`, `start_url: "/"`, `lang: "pt-BR"` e conjunto completo de ícones PNG validados para instalação Android e empacotamento em APK:
  - `icon-192x192.png` (`192×192`, `purpose: "any"`)
  - `icon-512x512.png` (`512×512`, `purpose: "any"`)
  - `icon-maskable-192x192.png` (`192×192`, `purpose: "maskable"`)
  - `icon-maskable-512x512.png` (`512×512`, `purpose: "maskable"`)
  - `apple-touch-icon.png` (`180×180`, iOS Home Screen)
- **Instalação em 1 Toque no Android & Câmera HTTPS (`getUserMedia`)**:
  - Captura o evento nativo `beforeinstallprompt` exibindo o botão discreto **Instalar** no HUD superior para adicionar o app direto à tela inicial do Android em modo tela cheia (`standalone`).
  - Validação explícita de contexto seguro (`window.isSecureContext`) em `ARCameraCanvas.tsx`, fallback progressivo de constraints em `navigator.mediaDevices.getUserMedia` (câmera traseira `environment` / frontal `user` até 60fps) e cabeçalho HTTP `Permissions-Policy: camera=(self)` no backend Express para compatibilidade total com Chrome Android, TWA (PWABuilder) e WebView do Capacitor.
- **Empacotamento em `.apk` (PWABuilder ou Capacitor)**:
  - **Via PWABuilder (mais rápido):** publique `frontend/` em HTTPS (Vercel/Netlify), cole a URL em [pwabuilder.com](https://www.pwabuilder.com) e gere o pacote Android TWA (`.apk` / `.aab`) usando o manifesto e ícones 192×192 / 512×512 já configurados.
  - **Via Capacitor:** inicialize `@capacitor/android` apontando `webDir` para `frontend/dist`, adicione `<uses-permission android:name="android.permission.CAMERA" />` no `AndroidManifest.xml` e gere o `.apk` no Android Studio.
- **Persistência Dupla (`frontend/src/lib/offlineStore.ts`)**: Todas as leituras e gravações (`loadStudioConfig`, `saveStudioConfig`, `loadNailDesigns`, `createNailDesign`, `deleteCustomDesign`) sincronizam com a API REST e mantêm cópia local em **IndexedDB (`nail-ar-studio-db`)** com redundância em `localStorage`.

---

## 8. Como Executar & Endpoints da API

### Pré-requisitos
- Node.js **22+** (necessário para suporte nativo a `node:sqlite`)
- npm

### Instalação, Seed, Build e Execução

```bash
# 1. Instalar dependências do backend e frontend
npm run install:all

# 2. Popular o banco SQLite (também ocorre automaticamente ao iniciar o servidor)
npm run seed

# 3. Desenvolvimento (em dois terminais)
npm run dev:backend    # API em http://localhost:3001
npm run dev:frontend   # Vite Dev Server em http://localhost:5173 (proxy para /api)

# 4. Build de Produção + Start Unificado
npm run build          # Compila backend/dist e frontend/dist
npm run start          # Inicia node backend/dist/index.js na porta 3001
```

### Endpoints da API REST (`/api`)

| Método | Rota | Descrição | Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Healthcheck do serviço e status do `node:sqlite` | `200` |
| `GET` | `/api/config` | Retorna a configuração White-Label atual do estúdio | `200` |
| `PUT` | `/api/config` | Atualiza nome, WhatsApp, logo, preset e cores do estúdio | `200` / `400` |
| `GET` | `/api/designs` | Lista todos os designs (aceita filtro `?category=francesinha\|gel\|cromado\|nail-art\|cliente`) | `200` / `400` |
| `GET` | `/api/designs/:id` | Busca um design específico por ID | `200` / `404` |
| `POST` | `/api/designs` | Cria um novo design ou referência importada da cliente | `201` / `400` |
| `PATCH` | `/api/designs/:id` | Atualiza parcialmente propriedades de um design existente | `200` / `400` / `404` |
| `DELETE` | `/api/designs/:id` | Remove um design pelo ID | `200` / `404` |

---

## 9. Governança de Documentação

Este repositório segue governança estrita de documentação contendo **exclusivamente 2 arquivos de documentação**:

1. `README.md` (este documento técnico na raiz do repositório)
2. `docs/documentacao.docx` (documentação oficial executiva e técnica em Word)

A leitura e atualização de `docs/documentacao.docx` são gerenciadas exclusivamente pelo utilitário `doc_manager.py`:

```bash
# Ler o conteúdo completo do documento oficial
python3 doc_manager.py read docs/documentacao.docx

# Acrescentar uma seção estruturada
python3 doc_manager.py update docs/documentacao.docx append_section '{"heading": "Título", "level": 2, "paragraphs": ["Texto"]}'

# Substituir trecho existente
python3 doc_manager.py update docs/documentacao.docx replace '{"old_text": "antigo", "new_text": "novo"}'
```

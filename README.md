# Nail AR Studio (`NailComparer`)

Provador virtual de unhas em **Realidade Aumentada (AR) ao vivo a 60fps** em formato **PWA Mobile-First** com estética **Luxury Beauty Tech** e motor **White-Label** instantâneo para nail designers, esmalterias e estúdios de beleza.

---

## 1. Visão Geral & Proposta Comercial (Luxury Beauty Tech PWA)

O **Nail AR Studio** elimina a indecisão da cliente na cadeira de atendimento e eleva a taxa de conversão de serviços premium (alongamento em gel, cromados, nail art autoral e francesinhas). Em vez de depender apenas de catálogos estáticos em papel ou fotos de terceiros, o estúdio oferece um **espelho digital interativo** diretamente no celular ou tablet:

- **Viewport Full-Bleed (`100dvh`)**: Câmera ou mão modelo ocupando 100% da tela com HUD flutuante em glassmorphism translúcido.
- **Experiência White-Label Pronta para Venda B2B**: Cada estúdio personaliza nome, WhatsApp, logotipo/monograma e paleta visual em tempo real, transformando o aplicativo em produto próprio da marca.
- **Zero Atrito & Offline-First**: Instalável como PWA (`manifest.webmanifest` + `sw.js`) e totalmente funcional mesmo sem internet no estúdio graças ao fallback automático em `IndexedDB` e `localStorage`.

---

## 2. Motor AR 3D V5: Three.js + PBR Procedural `1024×1024` + VolumetricNailMesh & Tracking 3D em Perfil

Os módulos [`frontend/src/lib/threeNailScene.ts`](frontend/src/lib/threeNailScene.ts), [`frontend/src/lib/nail3DGeometry.ts`](frontend/src/lib/nail3DGeometry.ts), [`frontend/src/lib/proceduralPBRSynthesizer.ts`](frontend/src/lib/proceduralPBRSynthesizer.ts), [`frontend/src/lib/perFingerVisionAnalyzer.ts`](frontend/src/lib/perFingerVisionAnalyzer.ts) e [`frontend/src/components/ARCameraCanvas.tsx`](frontend/src/components/ARCameraCanvas.tsx) implementam o pipeline procedural **V5 Per-Finger 3D PBR a 60fps** acoplado ao MediaPipe Hands (`HandLandmarker` em modo `VIDEO`, 21 landmarks):

- **VolumetricNailMesh com Cavidade Inferior Translúcida + AO (`createVolumetricNailGeometry`)**: Geometria `THREE.BufferGeometry` fechada (`24×30` subdivisões) dividida em **2 grupos de material**:
  - **Grupo 0 (`materialIndex: 0`)**: Casca dorsal esculpida com curvatura transversal **Arco C** (`cCurveDepth = 0.19`), elevação longitudinal do **Ápice Estrutural** e paredes laterais/ponta livre fechadas (`0.048` no ápice a `0.036` na borda livre).
  - **Grupo 1 (`materialIndex: 1`)**: Cavidade ventral côncava (`v ∈ [0.42, 1.0]`) com material de gel leitoso translúcido (`#F0E2D8`, `ior: 1.48`, `opacity: 0.92`), revelando o interior côncavo autêntico do alongamento quando a mão gira em perfil ou inclinação ventral, combinado a uma **sombra de contato AO** suave (`renderOrder: 1`) sob cada leito ungueal.
- **Sintetizador PBR Procedural `1024×1024` (`synthesizeProceduralPBRBundle`)**: Gera em memória (com cache por `specHash` para zero alocação por frame) mapas vetoriais cristalinos de `1024×1024` (`map` sRGB, `normalMap` via filtro Sobel 3×3 sobre campo de altura, `bumpMap`, `roughnessMap` e `metalnessMap`) + `alphaMap` (`512×512`) com fusão orgânica na cutícula — **zero pixels recortados de fotos brutas** são aplicados diretamente na malha 3D.
- **Fix de Tracking 3D em Perfil (`ThreeNailScene`)**: Aloca **estritamente 5 rigs únicos por dedo** (`Map<FingerId, FingerRig>`: `thumb`, `index`, `middle`, `ring`, `pinky`) ancorados exclusivamente no segmento distal **`DIP → TIP`** (zero duplicação em `PIP`/`MCP`), com normal dorsal ciente de lateralidade (`Left`/`Right` e espelhamento frontal `mirrorX`), ortogonalização Gram-Schmidt destrógira (`det(M) = +1`) suavizada por `Quaternion.slerp`, clamping de escala lateral para evitar colapso em giros de perfil e oclusores coaxiais invisíveis ao longo de `MCP → TIP`.
- **Adaptação Dinâmica à Iluminação da Pele (`sampleFingerSkinAmbient`)**: Amostra a cada frame o RGB e luminância da pele entre `PIP` e `DIP` para modular `HemisphereLight`, `DirectionalLight`, mapa de ambiente *Softbox Studio* (`THREE.PMREMGenerator`, 100% offline) e `ACESFilmicToneMapping`.
- **60FPS Performance & 3-Phalanx Depth Occlusion Hotfix**: `WebGLRenderer` com `pixelRatio <= 1.5` e `powerPreference: "high-performance"`, filtro adaptativo **One-Euro Filter + SLERP** por velocidade com zero síntese PBR no `requestAnimationFrame` (`detectForVideo` limitado a `video.currentTime !== lastVideoTime` e amostragem de pele ≥ 120 ms).
- **Hotfix `fix/nail-flip-and-palm-occlusion` (Inversão Dorsal/Ventral & Oclusão Real da Palma)**:
  - **Correção da inversão 180° dorsal/ventral**: Alinhamento do vetor normal `dorsalNormal` para combinações `Right`/`Left` × `mirrorX`, construção de base ortonormal destrógira (`det(M) = +1`, `X = normalize(Y × Z)`, `Z = normalize(X × Y)`) com fallback estável e aplicação de `THREE.FrontSide` no **Grupo 0** (casca dorsal PBR) e **Grupo 1** (cavidade leitosa ventral).
  - **Âncora da cutícula sobre o cilindro distal**: Cutícula posicionada em `lerp(DIP, TIP, 0.42)` e assentada sobre a superfície dorsal do cilindro distal (`dorsalOffset = distalOccluderRadius + nailW * 0.05`).
  - **Oclusores `CylinderGeometry` coaxiais**: Os 3 oclusores invisíveis por dedo (`MCP->PIP`, `PIP->DIP`, `DIP->TIP`) foram migrados para `CylinderGeometry` unitário coaxial (zero offset ventral artificioso, `radius = 1.05 * halfWidth` na falange distal, `colorWrite: false`, `depthWrite: true`, `renderOrder: 1`), terminando exatamente em `TIP` para oclusão real quando a palma vira para a câmera — expondo exclusivamente a borda livre estendida com cavidade leitosa ventral (`renderOrder: 2`).
- **Polimento V6 (`fix/anatomical-scale-and-underside`) — Escala Anatômica, Anti-Balanço, Realismo de Underside & Classificação por Proporção**:
  - **Escala anatômica dinâmica por dedo & travamento anti-balanço (`threeNailScene.ts`)**: Multiplicadores anatômicos calibrados por dedo (`thumb: 1.25x`, `index/middle/ring: 1.0x`, `pinky: 0.78x`) ancorados em `dist3D(DIP, TIP)` e `refHandDistalLen` (mediana das falanges distais médias), conectados ao `lengthMultiplier` (`0.85x`–`1.85x`). Estabilidade em 60fps via `OneEuroFilter` diferenciado por eixo (X/Y com `minCutoff: 1.18, beta: 0.05` e Z com `minCutoff: 0.75, beta: 0.025` + deadband sub-pixel) e estabilização angular de `dorsalNormal` e `Quaternion.slerp` com deadband `< 0.035 rad`.
  - **Realismo de underside, afunilamento lateral & oclusor distal (`threeNailScene.ts` + `nail3DGeometry.ts`)**: Textura procedural dedicada `createUndersideOcclusionTexture` com AO quente no hiponíquio/margens laterais e gel natural translúcido na borda livre, afunilamento lateral (`lateralTaper`) zerando a espessura da malha em `u = 0` e `u = 1` em `createVolumetricNailGeometry` para encaixe orgânico sem degraus, e raio do oclusor distal ajustado para cobertura `1.12x` da largura da unha (`distalOccluderRadius = (nailW * 0.5) * 1.12` / `fingerHalfW * 1.12`).
  - **Classificação automática de alongamento e formato na importação (`perFingerVisionAnalyzer.ts`)**: Análise geométrica baseada em `aspectRatio = altura_unha / largura_base`, `tipTapering` e `apexCurvature`, classificando automaticamente `extensionLevel` (`Curta/Natural`, `Pouco Alongada`, `Alongada`, `Muito Alongada (Extrema)`) mapeado ao multiplicador `0.85x–1.85x`, além do formato (`natural`, `square`, `coffin`/Bailarina, `almond`, `stiletto`).
- **V7 (`fix/ortho-lock-and-true-reference`) — Câmera Ortográfica 1:1, Escorço 3D Nativo & Analisador em 3 Zonas**:
  - **Projeção Ortográfica 1:1 + Escala Métrica Real (`threeNailScene.ts`)**: Substituição da `PerspectiveCamera` por `THREE.OrthographicCamera(0, cssW, cssH, 0, -1000, 1000)` casada 1:1 com o crop `object-fit: cover`, eliminando ticks de profundidade e balanço lateral via `OneEuroFilter(0.85, 0.04)` com `deadband: 0.35px` em `(X, Y)` (e `OneEuroFilter(0.65, 0.02)` em `Z`), além de escala métrica real `pxPerMeter = dist3D(wrist, middleMCP) / 0.085` suavizada por `OneEuroFilter(0.9, 0.03)`.
  - **Escorço 3D Nativo, Cápsulas Distais +18% & `cuticleTuck` (`threeNailScene.ts` + `nail3DGeometry.ts`)**: Dimensionamento anatômico nativo via `pxPerMeter` e comprimento distal 3D sem `dist2D(DIP, TIP)` (fim da explosão triangular ao inclinar o dedo para a lente); oclusores invisíveis em `THREE.CapsuleGeometry(0.5, 1.0, 8, 16)` com extensão distal `+18%` além de `TIP` para cobrir a polpa carnuda do dedo e embutimento proximal de ~2 mm (`cuticleTuck`) com âncora em `lerp(DIP, TIP, 0.40)`.
  - **Analisador de Referência em 3 Zonas (`perFingerVisionAnalyzer.ts` + cache PBR em `threeNailScene.ts`)**: Análise de placa ungueal segmentada em **3 zonas** — zona central/miolo livre de reflexo especular, contorno perimetral de 5% com detecção de `hasMetallicOutline` + `outlineColor` (pintado em cache PBR fora do `requestAnimationFrame`), e detecção de elementos centrais/blobs/strokes por componentes conectados + PCA para discriminar `floral_accent` vs. `gold_3d_waves`, preservando a classificação de comprimento por `aspectRatio`.

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

## 6. Analisador Visual por Dedo (`PerFingerVisionAnalyzer`), Síntese PBR & UI Limpa

- **PerFingerVisionAnalyzer (`frontend/src/lib/perFingerVisionAnalyzer.ts` + `ImportReferenceModal.tsx`)**:
  - Ao importar uma foto de referência (galeria ou câmera), executa MediaPipe `HandLandmarker` em modo **`IMAGE` (`numHands: 2`)** para localizar **todos os 5 dedos visíveis independentemente** (`thumb`, `index`, `middle`, `ring`, `pinky`) — com fallback inteligente `smart-macro` para closes extremos de 1 a 3 unhas.
  - Segmenta exclusivamente a placa ungueal (excluindo pele, anéis e fundo), mede formato (`natural`, `square`, `coffin`, `almond`, `stiletto`) e proporção (`relativeLength`, `relativeWidth`), extrai 3 camadas cromáticas (`baseColor`, `secondaryColor`, `accentColor`), detecta `strokeAnchors` `(u, v)` para relevos 3D e classifica entre **6 padrões artísticos**: `solid_gloss`, `chrome_mirror`, `gold_3d_waves`, `aura_gradient`, `french_tip` e `floral_accent`.
  - Aplica **Herança Harmônica (`applyHarmonicInheritance`)** para dedos não visíveis na foto, preservando unhas de destaque (*filha única* no anelar/médio) e harmonizando os demais dedos em um `Record<FingerId, NailFingerDesignSpec>` completo.
- **Prévia Vetorial Limpa Sem Pixel Sujo de Foto (`renderProceduralNailSwatchDataUrl`)**: Tanto o modal de importação (grade interativa dos 5 dedos com edição por dedo e botão *Uniformizar nos 5*) quanto o dock utilizam exclusivamente swatches vetoriais procedurais gerados a partir do `NailFingerDesignSpec` — garantindo zero pixel de foto borrada/cortada na renderização 3D e na UI.
- **Seletor Rápido + Dock Limpo em 2 Abas**: Seletor discreto de 5 formatos acima do dock, 2 abas limpas (**`Referência da Cliente`** e **`Catálogo do Estúdio`**) e destaque máximo para o botão **`+ Importar Referência`**.
- **Captura 3D com Marca d'Água & Antes/Depois (`CapturePreviewModal.tsx`)**: Compõe câmera/modelo + overlay WebGL Three.js 3D + selo editorial do estúdio em PNG pronto para compartilhar no WhatsApp.

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

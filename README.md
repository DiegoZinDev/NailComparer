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
- **Arquitetura Definitiva V8 (`fix/v8-zero-flicker-true-ar`) — Zero-Flicker, Oclusão de Palma Sem Vão, Calibração Realista de Salão & Patch UV Híbrido**:
  - **Estabilidade Zero-Flicker & Proteção Anti-Desaparecimento no Z-Buffer (`threeNailScene.ts`)**: Histerese de lateralidade (`HANDEDNESS_LOCK_FRAMES = 8`) combinada à guarda contra flip espúrio de normal (`dot(prevDorsal, candidateDorsal)`) e **Zero-Jitter Lock** para deslocamentos `< 1.2 px` (com decay `0.92` nos alvos do `OneEuroFilter` e amortecimento progressivo de `slerpAlpha`), somados à garantia física contra desaparecimento no Z-buffer (`dorsalOffset = Math.max(0.52 * fingerThickness, distalOccluderRadius - 0.22 * fingerThickness + 2.5)` contra o oclusor distal deslocado ventralmente em `-0.22 * fingerThickness`).
  - **Oclusão na Palma Virada Sem Vão Flutuante (`threeNailScene.ts` + `nail3DGeometry.ts`)**: Cápsula oclusora distal (`CapsuleGeometry`) encerrando precisamente em `TIP + 0.04 * (TIP - DIP)` para eliminar vão flutuante entre ponta do dedo e borda livre, acoplada ao underside **Grupo 1** em arco C côncavo com borda lateral contínua e gradiente de sombra quente de hiponíquio para gel marfim translúcido.
  - **Calibração Realista de Salão (`threeNailScene.ts` + `nail3DGeometry.ts`)**: Comprimento base natural ancorado em `0.58 * dist3D(DIP, TIP)`, multiplicadores proporcionais por formato (`natural: 1.00x`, `square: 1.22x`, `almond: 1.32x`, `coffin: 1.38x`, `stiletto: 1.48x`, com teto absoluto de `1.65x`) e afinamento lateral para Stiletto, Amendoada e Bailarina iniciando estritamente em `v > 0.55` (garantindo 100% de cobertura anatômica sobre o leito ungueal em `v <= 0.55`).
  - **Fidelidade Híbrida à Foto de Referência (`perFingerVisionAnalyzer.ts` + `proceduralPBRSynthesizer.ts`)**: Extração de **Patch UV Retificado `256×256`** dos 70% centrais da placa ungueal com normalização **Retinex / high-pass** (`perFingerVisionAnalyzer.ts`), composição híbrida `1024×1024` com *feathering* suave de bordas e geração automática de `normalMap` (filtro Sobel) + `metalnessMap`/`roughnessMap` para detalhes metálicos e relevos 3D em referências importadas, mantendo o sintetizador vetorial `1024×1024` limpo para o catálogo do estúdio (`proceduralPBRSynthesizer.ts`).

---

## 2.1 Arquitetura V9 (`feat/v9-photorealistic-ar-true-fidelity`) — AR Fotorrealista, Cinemática 3D & Reconstrução Híbrida

A versão **V9** redefine todo o pipeline de tracking, geometria anatômica, shaders PBR, reconstrução visual e experiência do estúdio em **4 Pilares Integrados**:

### Pilar 1: Tracking 3D Zero-Tick & Cinemática Anatômica Independente
- **Sincronização Zero-Tick (`ARCameraCanvas.tsx` + `handTrackingWorker.ts`)**: O loop de visão é sincronizado diretamente com a chegada de cada frame real da câmera via `video.requestVideoFrameCallback` (com fallback limpo por `video.currentTime` quando indisponível). O controlador desacoplado [`HandTrackerController`](frontend/src/lib/handTrackingWorker.ts) (`detectVideo` em modo `VIDEO` com timestamps estritamente monotônicos e `detectImage` para a mão modelo) retorna o pacote unificado `HandSkeletonFrame` contendo simultaneamente `landmarks` (2D normalizados) e `worldLandmarks` (métricos em 3D).
- **Filtro Contínuo Sem Chave Binária (`handKinematics.ts`)**: [`HandSkeletonFilter`](frontend/src/lib/handKinematics.ts) aplica o `OneEuroFilter` exato e contínuo (Casiez et al.) nos **21 pontos 2D** e nos **21 pontos `worldLandmarks`** antes da cinemática, eliminando qualquer chave binária `isStationary` (zero congelamento ou salto abrupto), com **histerese de lateralidade de 10 frames** (`HANDEDNESS_LOCK_FRAMES = 10`).
- **Câmera Perspectiva Calibrada & Projeção Métrica (`threeNailScene.ts` + `handKinematics.ts`)**: Substituição da projeção ortográfica por `THREE.PerspectiveCamera(58°, aspect, 0.01, 10.0)` na origem `(0, 0, 0)` olhando `-Z`, acoplada a `projectHandToPerspectiveMeters` para preservar escorço 3D nativo ao aproximar ou inclinar os dedos com erro sub-pixel no crop `object-fit: cover`.
- **Cinemática Independente por Dedo + Polegar Pronado (`handKinematics.ts`)**: `computeFingerAnatomicalBasis` constrói uma base ortonormal destrógira rigorosa (`det(M) = +1`) por dedo combinando o eixo lateral palmar e a normal do plano de flexão `(PIP - MCP) × (DIP - PIP)` (e fallback `(DIP - PIP) × (TIP - DIP)`), permitindo que cada dedo flexione `0° → 140°` de forma independente. Para o **polegar (`thumb`)**, aplica **pronação anatômica calibrada (~65°)** ao redor de `axisY` com estabilização de oposição e flexão.
- **Oclusão Volumétrica Completa da Mão (`threeNailScene.ts`)**: Além dos cilindros coaxiais nas 3 falanges (`MCP→PIP`, `PIP→DIP`, `DIP→TIP`) e esferas articulares em `MCP`, `PIP`, `DIP` mais a **polpa distal ventral** (`distalPulpMesh` em `lerp(DIP, TIP, 0.82)` deslocada `-0.12 * distalRadius` ao longo de `-axisZ`), a cena mantém um **oclusor volumétrico fechado da palma/metacarpos** em heptágono extrudado de 16 vértices (`WRIST`, `THUMB_CMC`, `THUMB_MCP`, `INDEX_MCP`, `MIDDLE_MCP`, `RING_MCP`, `PINKY_MCP`) pré-alocado fora do `requestAnimationFrame` (`renderOrder: 1`, `colorWrite: false`, `depthWrite: true`).

### Pilar 2: Malha Anatômica de Salão `40×48` & Shaders PBR Fotorrealistas
- **Malha Anatômica de Salão `40×48` (`nail3DGeometry.ts`)**: `createVolumetricNailGeometry` gera malha fechada de alta resolução (`40 × 48` subdivisões) suportando os **6 formatos de salão** (`natural`, `oval`, `almond`, `coffin`, `square`, `stiletto`) com pisos mínimos arredondados na ponta (`TIP_MIN_HALF_W` entre `0.085` no stiletto e `0.44` no square — **zero espinhos ou pontas cônicas**), aderência dorsal exata na cutícula (`zTop === 0` em `v = 0, u = 0.5`, `dorsalOffset = phalanxRadiusMeters * 0.88`), **Arco C** transversal (`cCurveDepth = 0.22`) e UVs contínuos compatíveis com relevo `displacementMap` 3D (`0.00022 m` a `0.00050 m`).
- **Skirt AO Conformal na Cutícula (`nail3DGeometry.ts` + `nailShaderMaterials.ts`)**: `createCuticleContactSkirtGeometry` constrói uma casca curva conformal acompanhando o contorno parabólico da cutícula (`v ∈ [-0.04, 0.24]`) e sulcos laterais (`v ∈ [0, 0.58]`), renderizada com textura quente rosada-marrom em `THREE.MultiplyBlending` (`depthWrite: false`, `premultipliedAlpha: false`) para fundir organicamente a lâmina ungueal à pele sem retângulos ou halos brancos.
- **Shaders PBR & Studio Room PMREM IBL (`nailShaderMaterials.ts`)**: `createStudioRoomEnvMap` sintetiza via `THREE.PMREMGenerator` um ambiente de estúdio com janelas de céu em gradiente, difusores *softbox*, faixa especular fina para reflexo líquido de gel UV (`clearcoat: 1.0`, `clearcoatRoughness: 0.035`, `ior: 1.52`) e rebatedor quente inferior em tom de pele, modulados por `sampleDirectionalSkinLight` (3 patches `6×6` para estimar cor, luminância, azimute e elevação da luz real do ambiente).
- **Underside Côncavo Translúcido Tingido Dinamicamente (`nailShaderMaterials.ts`)**: A cavidade ventral (`Grupo 1`, `v >= 0.40`) recebe `createUndersideNailMaterial` com `aoMap` de sulcos laterais/hiponíquio e `updateUndersideMaterialTint` executado exclusivamente na troca de cor/design (fora do RAF), mesclando ~30% da cor do esmalte dorsal ao marfim quente translúcido (`#E6D5C8`) na borda livre.

### Pilar 3: Pipeline Híbrido de Reconstrução de Referência & Migração SQLite V9
- **Endpoint Vision AI Backend (`POST /api/vision/reconstruct-reference`)**: Implementado em [`VisionController`](backend/src/controllers/VisionController.ts), [`VisionDto`](backend/src/dtos/VisionDto.ts) e [`ReferenceVisionService`](backend/src/services/ReferenceVisionService.ts). Quando `GEMINI_API_KEY` ou `OPENAI_API_KEY` estão configuradas, realiza reconstrução estruturada por dedo (`shape`, `tipRoundness`, `extensionMm`, `lengthMultiplier`, cores HEX, `finish`, relevos e texturas UV canônicas `1024×1024`); quando ausentes, responde cleanly `{ mode: 'local-fallback-required', configured: false }`.
- **Fallback Local High-Res `320×480` → UV `512×512` (`perFingerVisionAnalyzer.ts` + `proceduralPBRSynthesizer.ts`)**: Extrai ROI vertical em alta resolução `320×480` por dedo diretamente da foto original, segmenta a placa ungueal (CIELab + HSV + Sobel + prior elíptico) e retifica textura UV `512×512` cobrindo **94% da placa** (`u ∈ [0.03, 0.97], v ∈ [0.04, 0.96]`). Executa **inpainting cirúrgico apenas nos pixels de reflexo especular estourado** (`luma > 0.92 && sat < 0.12`), preservando integralmente cores profundas como vinho (`#52101E`), preto ou esmaltes escuros, derivando `displacementMap`, `normalMap` via operador **Scharr 3×3**, `metalnessMap`, `roughnessMap` e swatches reais fotorrealistas (`swatchPreview.ts`).
- **Migração SQLite V9 (`database.ts` + `NailDesign.ts` + `NailDesignRepository.ts`)**: Evolução idempotente da tabela `nail_designs` (`ensureNailDesignV9Columns`) adicionando `secondary_color`, `finish`, `detected_shape`, `detected_length`, **`finger_specs_json`** (especificações completas dos 5 dedos + mapas UV) e **`is_studio_catalog`** (distinção explícita entre *Catálogo do Estúdio* e *Referência da Cliente*).

### Pilar 4: UX Clean, Zero Seeds Fictícios & Catálogo do Estúdio Real
- **UX Limpa Sem Barra de Formatos "Joguinho" (`App.tsx` + `ARCameraCanvas.tsx` + `MagneticDesignDock.tsx`)**: Remoção da barra inferior fixa de seleção rápida de formatos, iniciando na mão natural limpa com CTA contextual discreto (*Importar Foto* / *Catálogo*) e 2 abas limpas no dock (`Referência da Cliente` e `Catálogo do Estúdio`).
- **Zero Seeds Fictícios (`presets.ts` + `seed.ts`)**: `SEED_NAIL_DESIGNS` e `DEFAULT_NAIL_DESIGNS` são estritamente vazios (`[]`). O catálogo nasce limpo para que o estúdio cadastre seus próprios trabalhos reais.
- **Micro-Ajustes Técnicos de Encaixe (`NailAdjustControls.tsx`)**: Drawer enxuto focado exclusivamente em **Largura de Encaixe (`0.85x–1.20x`)**, **Comprimento Fino (`±15%`)** e **Opacidade / Realismo (`70%–100%`)**, mantendo a geometria/formato anatômico detectado da referência ou modelo cadastrado.
- **Fluxo Oficial do Catálogo do Estúdio (`ImportReferenceModal.tsx` + `MagneticDesignDock.tsx`)**: O mesmo motor de reconstrução V9 alimenta o botão *Cadastrar Modelo* na aba `Catálogo do Estúdio`, salvando modelos reais com `isStudioCatalog: true` e `category: 'estudio'`.
- **Remoção de Código Morto**: Exclusão definitiva dos motores legados `frontend/src/lib/webglNailEngine.ts`, `frontend/src/lib/nail3DReconstructor.ts` e `frontend/src/lib/nailExtractor.ts`, além de zero vídeos `.mp4` no repositório.

---

## 2.2 Arquitetura V10 (`feat/v10-fast-60fps-math-3d-pwa`) — Motor 60fps Mobile, Adaptação Anatômica Real, Blueprint Matemático & PWA 1-Toque

A versão **V10** consolida o provador para uso comercial em celulares reais e hospedagem 100% gratuita (*Vercel Free Tier*), eliminando gargalos de CPU/GPU, APIs pagas de visão e distorções de encaixe através de **4 Pilares Integrados**:

### Pilar 1 — Otimização Radical 60fps Mobile
- **`<video>` Direto via CSS `object-fit: cover` (`ARCameraCanvas.tsx`)**: Fim da cópia 2D `ctx.drawImage(video)` 60×/s em canvas intermediário; o `<video>` e a mão modelo `<img>` são renderizados nativamente pelo compositor do navegador com overlay WebGL transparente (`pointerEvents: none`).
- **Capture Sob Demanda com `preserveDrawingBuffer: false` (`threeNailScene.ts` + `ARCameraCanvas.tsx`)**: O contexto WebGL é inicializado com `preserveDrawingBuffer: false` e expõe `renderNow()`, chamado pontualmente na captura para garantir buffer válido sem penalizar o swapchain a cada frame.
- **Pixel Ratio Adaptativo & Singleton MediaPipe (`threeNailScene.ts` + `handTrackingWorker.ts`)**: `pixelRatio <= 1.25` em viewports mobile (`<= 1.5` em desktop) e singleton único `@mediapipe/tasks-vision@0.10.18` WASM com pacing ~30Hz (`minIntervalMs: 30`) desacoplado do loop WebGL de 60fps.
- **Oclusor Instanciado em Apenas 3 Draw Calls (`threeNailScene.ts`)**: Substituição de dezenas de meshes individuais por **2× `THREE.InstancedMesh`** (`15` cilindros de falange = 1 draw call + `20` esferas articulares/polpas distais = 1 draw call) + **1 mesh único da palma** (`16` vértices), reduzindo o oclusor inteiro da mão a apenas **3 draw calls**.
- **Malha `20×24` & Fast-Path Opaco (`nail3DGeometry.ts` + `nailShaderMaterials.ts` + `App.tsx`)**: Redução da malha para `20×24` (`2.096` triângulos/unha mantendo Arco C `0.22` e cavidade ventral), `DEFAULT_ADJUSTMENT.opacity = 1.0` ativando o caminho rápido opaco (`transparent: false, depthWrite: true`), mapas PBR otimizados em **`512×512`** (`albedo`/`alpha`) e **`256×256`** (`normalMap`/`roughnessMap`/`metalnessMap`, ~12 MB VRAM total), **zero `displacementMap` / `bumpMap`** e **1 único readback `64×64` a cada `350ms`** compartilhado entre iluminação direcional e calibração ao vivo.

### Pilar 2 — Adaptação Anatômica Real à Unha da Cliente
- **Calibração Ao Vivo da Largura do Dedo (`liveFingerCalibrator.ts` + `handKinematics.ts`)**: [`LiveFingerCalibrator`](frontend/src/lib/liveFingerCalibrator.ts) traça um perfil transversal 1D de **32 amostras** perpendicular ao eixo `DIP → TIP` em `lerp(DIP, TIP, 0.35)` sobre o buffer compartilhado `64×64`, suavizado com **EMA lento (`0.08`)** e mapeado para `nailWidthMeters = 0.85 * liveFingerWidth`.
- **Zero Distorção por Largura da Referência (`threeNailScene.ts`)**: A largura nativa da cliente controla 100% do encaixe lateral; `spec.relativeWidth` é ignorado na geometria 3D para que fotos importadas nunca estreitem ou alarguem artificialmente o dedo real da cliente.
- **Cobertura Integral do Leito (`threeNailScene.ts` + `nail3DGeometry.ts`)**: `bedFraction = 1 / (1 + freeEdgeRatio)` (quantizado e limitado em `[0.44, 0.90]`) garante paredes paralelas sobre 100% do leito real da cliente (`v <= bedFraction`), restringindo o afinamento do formato (Stiletto, Amendoada, Bailarina) estritamente à borda livre (`v > bedFraction`).

### Pilar 3 — Motor Matemático `NailDesignBlueprint` & Compilador PBR Vetorial Limpo (100% Client-Side / R$ 0,00)
- **Extração Puramente Matemática Client-Side (`perFingerVisionAnalyzer.ts`)**: Opera em ROI compacto `128×192`, segmentando a placa ungueal com **flood-fill CIELab + YCbCr** anti-pele/fundo/anel, **K-Means determinístico em CIELab (`k = 4`)**, perfil geométrico **`profileHalfWidths[8]`**, **`borderLayer`** (francesinha, contorno metálico, cuff de cutícula) e vetorização automática de arte em **`ribbon_stroke`** (simplificação Ramer-Douglas-Peucker — RDP), **`organic_motif`** (contornos suaves de ~20 pontos) e **`micro_gem`** (pérolas, esferas douradas, cristais).
- **Compilador PBR Vetorial `512×512` (`proceduralPBRSynthesizer.ts` + `swatchPreview.ts`)**: Compila mapas PBR limpos com filtro **Sobel 3×3 rápido (< 15ms/dedo)** a partir do `NailDesignBlueprint` — **ZERO pixels crus de foto em malhas 3D ou swatches**.
- **Remoção Total da Rota Paga & Persistência Compacta (`apiRoutes.ts` + `NailDesignDto.ts`)**: Remoção definitiva de `VisionController.ts`, `ReferenceVisionService.ts`, `VisionDto.ts` e da rota `/api/vision/reconstruct-reference` (custo zero de API externa). Cada `blueprint` JSON compacto (**< 6 KB**) é persistido localmente em `IndexedDB` e no `SQLite` via `fingerSpecs`.

### Pilar 4 — Retorno Definitivo do Botão Instalar PWA & HUD `360px`
- **Botão `Instalar` Sempre Visível Fora do Modo `standalone` (`App.tsx` + `InstallAppModal.tsx`)**: O botão **Instalar** no `.top-hud` permanece visível sempre que `!isStandalone`, disparando `beforeinstallprompt` nativo em 1 toque quando disponível ou abrindo o guia visual responsivo [`InstallAppModal`](frontend/src/components/InstallAppModal.tsx) para Android (Chrome/Edge) e iOS (Safari).
- **Blindagem Responsiva em `360px` (`index.css`)**: `.top-hud` sem quebra de linha (`flex-wrap: nowrap`), truncamento elegante em `.brand-pill` (`min-width: 0`, `text-overflow: ellipsis`) e botões compactos garantindo encaixe perfeito sem overflow horizontal a partir de `360px`.

---

## 2.3 Arquitetura V11 (`feat/v11-deep-per-finger-3d-reconstruction`) — Reconstrução Profunda Unha-por-Unha com Auto-Verificação Visual, Acessórios 3D Reais & Gemini Free Tier (R$ 0,00)

A versão **V11** preserva 100% da performance 60fps da V10 e corrige definitivamente os 4 gargalos visuais/ópticos identificados em produção:

### Pilar 1 — Correção Visual 3D, Cromado Espelhado Real & Acessórios 3D Geométricos
- **Fim da Borda Branca (`nailShaderMaterials.ts`)**: `createCuticleContactSkirtMaterial()` removeu `THREE.MultiplyBlending` e o preenchimento `#FFFFFF` (que geravam pixels brancos sobre `<canvas>` WebGL transparente), passando a usar `THREE.NormalBlending` com micro-sombra quente translúcida (`rgba(36, 15, 11, <= 0.30)`) restrita à dobra proximal da cutícula.
- **Fim da Malha "Garrafa de Leite" (`nail3DGeometry.ts`)**: `evalNailHalfWidth` ignora perfis ruidosos de pixels crus (`profileHalfWidths`), operando exclusivamente sobre equações paramétricas lisas e monotônicas de salão para os 6 formatos (`natural`, `oval`, `almond`, `coffin`, `square`, `stiletto`) no grid leve `20×24`, e exporta `evaluateNailSurfacePointAndNormal(u, v, shape, opts)` para ancoragem exata de acessórios 3D.
- **HDRI Studio Room de Alto Contraste & Acabamentos Ópticos (`nailShaderMaterials.ts`)**: Ambiente PMREM de estúdio com janelas HDR (`intensity 3.8–4.5`) contra painéis escuros `#0C0A0E` e rebatedor quente inferior, somado a `applyFinishTypeToDorsalMaterial` para `mirror_chrome` (`metalness >= 0.92`, `roughness <= 0.09`), `glazed_pearl`, `solid_gloss_gel`, `jelly_translucent`, `cat_eye_magnetic`, `velvet_matte` e `glitter_suspension`.
- **Acessórios 3D Reais Instanciados + Sets de 5 ou 10 Dedos (`threeNailScene.ts`)**: 4 `THREE.InstancedMesh` dedicados (`metalStudInstancedMesh`, `pearlInstancedMesh`, `rhinestoneInstancedMesh`, `clearDropInstancedMesh`, `renderOrder = 3`) posicionam studs metálicos, pérolas, strass e gotas 3D reais sobre `evaluateNailSurfacePointAndNormal(u, v)` com cor por instância (`setColorAt`), além de suporte nativo a sets distintos de **Mão Esquerda e Mão Direita (`handSpecsBySide`)**.

### Pilar 2 & 3 — Pipeline Profundo Unha-por-Unha, Render 3D Offscreen & Loop Fechado de Auto-Verificação (R$ 0,00)
- **Serverless Gratuita Vercel + Espelho Express (`frontend/api/reconstruct-nail.ts` + `backend/src/services/NailReconstructionService.ts` + `VisionController.ts`)**: Usa **Google Gemini API Free Tier** (`gemini-2.5-flash` com fallback automático para `gemini-2.5-flash-lite` + backoff exponencial em HTTP `429`) em 3 ações estruturadas:
  1. `analyze_global`: mapeia iluminação do ambiente, 1 ou 2 mãos (5 ou 10 dedos), grupos idênticos e *filha única*.
  2. `analyze_finger`: recebe foto global + recorte verticalizado `384×512` de cada unha com regra explícita de desambiguação óptica para cromados/espelhados (impedindo reflexos escuros de virarem listras falsas) e gera o contrato técnico `Nail3DManufacturingSpec`.
  3. `verify_and_refine`: recebe imagem comparativa **Lado a Lado (`768×512` — Referência Real | Render 3D Offscreen)** gerada por [`OffscreenNailRenderSession`](frontend/src/lib/offscreenNailRenderer.ts), atribuindo `fidelityScore` (`0–100`) e refinando automaticamente até `2` rodadas sempre que `< 92%`.
- **Orquestrador Client-Side & Compilador PBR (`deepNailReconstructor.ts` + `proceduralPBRSynthesizer.ts` + `swatchPreview.ts`)**: Executa os 4 estágios com progresso vivo, botão **Cancelar**, renderização de anéis de engaste AO sob acessórios 3D e swatches baseados nos snapshots 3D reais (`preview3DDataUrl`). Sem chave configurada, cai graciosamente no modo offline paramétrico limpo.

### Pilar 4 — UX de Progresso Profundo, Comparativo Lado a Lado & Ativação em 30 Segundos (R$ 0,00)
- **Importação & Configurações (`ImportReferenceModal.tsx`, `WhiteLabelModal.tsx`, `MagneticDesignDock.tsx`, `offlineStore.ts`)**: Stepper vivo dedo-a-dedo, comparativo **Referência Real vs Molde 3D**, abas `Mão Dir. / Mão Esq.` para sets de 10 dedos, selo de fidelidade `%` no modal e no dock, e persistência completa de `manufacturingSpec` + `handSpecsBySide` no `IndexedDB` e `SQLite`.
- **Como ativar a Visão 3D Profunda gratuitamente em 30 segundos (R$ 0,00, sem cartão de crédito):**
  1. Acesse [aistudio.google.com/apikey](https://aistudio.google.com/apikey) e clique em **Create API key**.
  2. Cole a chave **na Vercel** em *Project Settings → Environment Variables* como `GEMINI_API_KEY` (e faça redeploy) **OU** cole diretamente dentro do app em **Configurações (ícone de engrenagem) → Visão 3D Profunda (Google AI Studio — R$ 0,00)** para ativar na hora sem redeploy.

---

## 2.4 Arquitetura V12 (`feat/v11-true-uv-texture-transfer`) — Transferência Direta de Textura UV `512×512`, PBR Derivado de Pixels, Lupa de Pinça UV 4× & Feathering Gaussiano (100% Client-Side / R$ 0,00)

A versão **V12** substitui a vetorização cartunesca na importação por **transferência direta fotorrealista de pixels UV `512×512`** rodando 100% no navegador (iOS Safari + Android Chrome + Vercel Free Tier, `< 300ms`, custo `R$ 0,00`):

- **`TrueUVExtractor` (`perFingerVisionAnalyzer.ts`)**: Localiza os 5 dedos via singleton MediaPipe (`numHands: 2`), contrai estritamente para o polígono interno seguro de **88% (`u ∈ [0.06, 0.94]`, `v ∈ [0.06, 0.94]`)** — excluindo pele, anéis e fundo — e executa **unwarping bilinear direto `512×512`** da imagem full-res com nivelamento linear ultra-suave (`[0.92, 1.08]`) preservando integralmente cromados espelhados, esferas metálicas 3D, strass e pigmentos profundos (`WebP 0.92` com fallback automático `PNG`).
- **Síntese PBR Física a partir dos Próprios Pixels (`proceduralPBRSynthesizer.ts`)**: Prioridade absoluta para `spec.trueUvDataUrl` (com cache por hash fora do RAF), gerando `map` (`512×512`, `SRGBColorSpace`), `normalMap` (`512×512`, `NoColorSpace` via pré-blur `3×3` + Sobel `strength = 3.2`), `metalnessMap` (`256×256` contínuo até `0.85`, com piso `0.55..0.85` em placas cromadas espelhadas) e `roughnessMap` (`256×256`, `0.08..0.28`), sobre `HTMLCanvasElement` estritamente Power-of-Two com mipmaps (`LinearMipmapLinearFilter`) para WebGL2 iOS Safari e Android Chrome.
- **Lupa de Pinça UV 4× Interativa & Swatch Real (`ImportReferenceModal.tsx` + `swatchPreview.ts`)**: Estágio touch-first (`touch-action: none`) com zoom `4×`, contorno tracejado dos 88% internos + mira central, arraste por Pointer Events (`onPointerDown/Move/Up`), ajuste rápido de tamanho (`- / +`) e ângulo (`-30°..+30°`), re-extração em tempo real (`~40ms`), botão **"Aplicar esta textura nos 5 dedos"** e swatch recortado em silhueta anatômica com Arco C e brilho UV no dock.
- **Feathering Gaussiano Sem Borda Branca & Blindagem dos 5 Dedos (`nailShaderMaterials.ts` + `proceduralPBRSynthesizer.ts` + `threeNailScene.ts`)**: `alphaMap` `256×256` com rampa gaussiana suave na cutícula (`v ∈ [0, 0.14]`) e laterais (`u ∈ [0, 0.06] ∪ [0.94, 1.0]`) combinada a `transparent: true, alphaTest: 0, premultipliedAlpha: false, depthWrite: true, clearcoat: 1.0, clearcoatRoughness: 0.03`, mais piso anatômico explícito contra colapso do dedo mínimo (`pinky >= max(0.0082, middleWidth * 0.68)`, `bedLength >= 0.0078`).

---

## 3. Arquitetura em Camadas no Backend (Clean / Spring-Style)

O servidor (`backend/src/`) segue separação estrita de responsabilidades inspirada em **Spring Boot / Clean Architecture**, utilizando Node.js + Express + TypeScript:

```text
backend/src/
├── controllers/   # Camada HTTP (Request/Response + delegação para Services)
│   ├── HealthController.ts
│   ├── StudioConfigController.ts
│   └── NailDesignController.ts
├── services/      # Regras de negócio, validação de DTOs & AppError (100% gratuito, zero VLM pago)
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

- **Regra de Isolamento SQL**: Nenhuma query SQL (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, `ALTER TABLE`, `PRAGMA`) existe em `controllers/` ou `services/`; toda persistência é encapsulada em `repositories/` e `db/`.
- **Serving Unificado em Produção**: Quando `frontend/dist/` está compilado, o backend Express serve os assets estáticos e fallback SPA diretamente na mesma origem (`http://localhost:3001`).

---

## 4. Banco `node:sqlite` & Catálogo Real Sem Seeds Fictícios

O banco relacional embarcado utiliza o módulo nativo `node:sqlite` (`DatabaseSync`) em `backend/data/nail-studio.sqlite` com `PRAGMA journal_mode = WAL` e `PRAGMA foreign_keys = ON`.

- **Tabelas**:
  - `studio_config` (`id = 1` singleton): nome do estúdio, WhatsApp, `logo_data_url`, `theme_preset`, `primary_color`, `accent_color`, `surface_color`, `updated_at`.
  - `nail_designs`: catálogo real do estúdio e referências das clientes (`id`, `name`, `category`, `style_type`, `base_color`, `accent_color`, `secondary_color`, `finish`, `pattern_type`, `image_data_url`, `default_scale`, `default_rotation`, `default_opacity`, `is_custom_reference`, `is_studio_catalog`, `detected_shape`, `detected_length`, `finger_specs_json`, `created_at`).
- **Migração Idempotente (`ensureNailDesignV9Columns`)**: Garante automaticamente a presença das colunas (`secondary_color`, `finish`, `detected_shape`, `detected_length`, `finger_specs_json`, `is_studio_catalog`) em bancos pré-existentes sem perda de dados, armazenando agora o `blueprint` V10 compacto (< 6 KB) dentro de `finger_specs_json`.
- **Seed Idempotente (`backend/src/db/seed.ts`)**: Executado automaticamente no startup (`startServer()`) e via `npm run seed`. Popula exclusivamente a configuração White-Label padrão **`Atelier Lumière Nails`** mantendo **`DEFAULT_NAIL_DESIGNS = []`** (zero seeds fictícios de unhas — catálogo 100% real cadastrado pelo estúdio).

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

## 6. Analisador Matemático (`PerFingerVisionAnalyzer`), Síntese PBR Vetorial & UI Limpa

- **Pipeline 100% Client-Side (`frontend/src/lib/perFingerVisionAnalyzer.ts` + `ImportReferenceModal.tsx`)**:
  - Ao importar uma foto de referência (ou cadastrar um modelo no Catálogo do Estúdio), executa integralmente no navegador (custo zero de API externa) com MediaPipe `HandLandmarker` em modo **`IMAGE` (`numHands: 2`)** e fallback macro `smart-macro`.
  - Extrai ROI `128×192`, segmenta via flood-fill CIELab/YCbCr, aplica K-Means CIELab (`k = 4`), extrai `profileHalfWidths[8]`, `borderLayer` e vetoriza artes em `ribbon_stroke` (RDP), `organic_motif` (~20 pts) e `micro_gem` dentro de um `NailDesignBlueprint` compacto (< 6 KB).
  - Aplica **Herança Harmônica (`applyHarmonicInheritance`)** para dedos não visíveis na foto, preservando unhas de destaque (*filha única*) em um `Record<FingerId, NailFingerDesignSpec>` completo.
- **Compilador PBR Vetorial & Swatches Limpos (`proceduralPBRSynthesizer.ts` + `swatchPreview.ts` + `MagneticDesignDock.tsx`)**: Compila mapas PBR `512×512`/`256×256` com Sobel 3×3 (< 15ms/dedo) e swatches vetoriais limpos (zero pixels crus de foto) nas 2 abas (**`Referência da Cliente`** e **`Catálogo do Estúdio`**), com CTAs contextuais **`Importar Referência`** e **`Cadastrar Modelo`**.
- **Captura 3D com Marca d'Água & Antes/Depois (`CapturePreviewModal.tsx`)**: Compõe câmera/modelo + overlay WebGL Three.js 3D (usando `renderNow()` sob demanda) + selo editorial do estúdio em PNG pronto para compartilhar no WhatsApp.

---

## 7. PWA Instalável no Android/iOS, Empacotamento `.apk` & Resiliência Offline

- **Configuração `vite-plugin-pwa` + Workbox (`frontend/vite.config.ts`)**: Gera automaticamente o manifesto oficial (`manifest.webmanifest`) e o Service Worker Workbox (`sw.js`) com registro `autoUpdate` via `virtual:pwa-register`, pré-cache dos assets estáticos e runtime caching dedicado para módulos WASM/modelo do MediaPipe Hands (`CacheFirst`), Google Fonts (`CacheFirst`) e API `/api/*` (`NetworkFirst`).
- **Web App Manifest & Ícones Oficiais (`frontend/public/icons/`)**: Configurado com `display: "standalone"`, `display_override: ["standalone", "fullscreen"]`, `orientation: "portrait"`, `start_url: "/"`, `lang: "pt-BR"` e conjunto completo de ícones PNG validados para instalação Android e empacotamento em APK:
  - `icon-192x192.png` (`192×192`, `purpose: "any"`)
  - `icon-512x512.png` (`512×512`, `purpose: "any"`)
  - `icon-maskable-192x192.png` (`192×192`, `purpose: "maskable"`)
  - `icon-maskable-512x512.png` (`512×512`, `purpose: "maskable"`)
  - `apple-touch-icon.png` (`180×180`, iOS Home Screen)
- **Botão `Instalar` Sempre Visível Fora de `standalone` (`App.tsx` + `InstallAppModal.tsx`)**:
  - Exibe o botão **Instalar** no `.top-hud` (inclusive em telas `360px`) sempre que o app não estiver em modo `standalone`; dispara `beforeinstallprompt` em 1 toque quando disponível ou abre `InstallAppModal` com passo-a-passo visual para Android (Chrome/Edge) e iOS (Safari).
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
| `GET` | `/api/designs` | Lista todos os designs (aceita filtro `?category=estudio\|francesinha\|gel\|cromado\|nail-art\|cliente`) | `200` / `400` |
| `GET` | `/api/designs/:id` | Busca um design específico por ID | `200` / `404` |
| `POST` | `/api/designs` | Cria um novo modelo do catálogo do estúdio ou referência da cliente (com `fingerSpecs` e `isStudioCatalog`) | `201` / `400` |
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

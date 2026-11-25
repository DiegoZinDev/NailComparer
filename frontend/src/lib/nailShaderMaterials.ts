import * as THREE from 'three';
import type { NormalizedPoint } from '../types/nail';

export interface UndersideMaterialBundle {
  material: THREE.MeshPhysicalMaterial;
  map: THREE.CanvasTexture;
  aoMap: THREE.CanvasTexture;
  baseColor: string;
  dispose: () => void;
}

export interface CuticleSkirtMaterialBundle {
  material: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
}

export interface DirectionalAmbientLightSample {
  r: number;
  g: number;
  b: number;
  luma: number;
  lightAzimuthX: number;
  lightElevationY: number;
}

export const DEFAULT_DIRECTIONAL_AMBIENT: DirectionalAmbientLightSample = {
  r: 0.78,
  g: 0.63,
  b: 0.54,
  luma: 0.66,
  lightAzimuthX: -0.22,
  lightElevationY: 0.58,
};

const UNDERSIDE_TEX_SIZE = 256;
const SKIRT_TEX_SIZE = 128;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseHexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { r, g, b };
    }
  } else if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { r, g, b };
    }
  }
  return { r: 224, g: 196, b: 186 };
}

function rgbCss(r: number, g: number, b: number, a = 1): string {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));
  return a < 1 ? `rgba(${cr}, ${cg}, ${cb}, ${a.toFixed(3)})` : `rgb(${cr}, ${cg}, ${cb})`;
}

/**
 * Generates an HDR-dynamic Studio Room Environment Map via `THREE.PMREMGenerator`
 * featuring natural sky-gradient rectangular windows, dual softbox diffusers,
 * a crisp high-intensity specular strip for liquid UV-gel catchlights,
 * a warm skin-toned lower bounce card, and soft ambient room fill.
 * Cleans up all temporary scene geometries, materials, and the PMREM generator.
 */
export function createStudioRoomEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x1e181b);

  const disposables: Array<{ dispose: () => void }> = [];

  const addPanel = (
    w: number,
    h: number,
    pos: [number, number, number],
    colorOrCanvas: THREE.Color | HTMLCanvasElement,
    intensityScale = 1
  ) => {
    const geo = new THREE.PlaneGeometry(w, h);
    let mat: THREE.MeshBasicMaterial;
    if (colorOrCanvas instanceof THREE.Color) {
      mat = new THREE.MeshBasicMaterial({
        color: colorOrCanvas,
        side: THREE.DoubleSide,
      });
    } else {
      const tex = new THREE.CanvasTexture(colorOrCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      disposables.push(tex);
      mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(intensityScale, intensityScale, intensityScale),
        side: THREE.DoubleSide,
      });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
    disposables.push(geo, mat);
  };

  // 1) Rectangular natural daylight windows with subtle sky gradient
  const makeWindowCanvas = (topHex: string, bottomHex: string) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const ctx = c.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, c.height);
      grad.addColorStop(0, topHex);
      grad.addColorStop(0.55, '#F5F7FA');
      grad.addColorStop(1, bottomHex);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    return c;
  };

  const skyWindowCanvas = makeWindowCanvas('#C8DDF5', '#F7ECE4');
  addPanel(9, 13, [-7.5, 4.5, 5.5], skyWindowCanvas, 1.55);
  addPanel(7, 11, [7.8, 3.8, 4.8], skyWindowCanvas, 1.35);

  // 2) Dual salon softbox diffusers (overhead key + front-fill diffuser)
  addPanel(13, 6.5, [-1.2, 7.2, 4.2], new THREE.Color(2.25, 2.16, 2.08));
  addPanel(8, 5.5, [4.2, 5.8, -3.5], new THREE.Color(1.45, 1.48, 1.58));

  // 3) Crisp thin specular light strip for razor-sharp liquid UV-gel catchlights along the C-curve
  addPanel(14, 0.75, [0.4, 4.8, 6.8], new THREE.Color(3.6, 3.55, 3.48));
  addPanel(0.85, 11, [-5.6, 2.2, 6.2], new THREE.Color(2.9, 2.95, 3.1));

  // 4) Warm skin-toned lower bounce reflector card
  addPanel(18, 18, [0, -7.2, 1.0], new THREE.Color(0.72, 0.48, 0.41));

  // 5) Soft enveloping room fill behind camera / walls
  addPanel(16, 12, [0, 0.5, -9.0], new THREE.Color(0.46, 0.41, 0.43));

  const envRT = pmrem.fromScene(envScene, 0.032);

  for (const item of disposables) {
    item.dispose();
  }
  pmrem.dispose();

  return envRT.texture;
}

/**
 * Dorsal UV-gel physical material (`V10` 60fps mobile fast-path):
 * - Glossy wet UV clearcoat (`clearcoat: 1.0`, `clearcoatRoughness: 0.04`, `ior: 1.52`)
 * - ZERO `displacementMap` / `bumpMap` vertex texture fetches on mobile GPUs
 *   (uses only `map`, `normalMap`, `roughnessMap`, `metalnessMap`)
 * - Zero white border halo (`transparent: false`, `depthWrite: true` by default;
 *   `applyDorsalMaterialOpacity` enables alpha blending only when `opacity < 0.99`).
 */
export function createDorsalNailMaterial(
  envMap: THREE.Texture | null
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff'),
    roughness: 1.0,
    metalness: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    ior: 1.52,
    specularIntensity: 1.0,
    envMap,
    envMapIntensity: 1.4,
    normalScale: new THREE.Vector2(1.15, 1.15),
    transparent: false,
    opacity: 1.0,
    alphaTest: 0.02,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
  });
}

/**
 * Helper to adjust dorsal nail opacity without white edge halos:
 * keeps `transparent: false` + `depthWrite: true` when opaque (`>= 0.99`),
 * enabling smooth alpha blending only when genuinely translucent (`< 0.99`).
 */
export function applyDorsalMaterialOpacity(
  material: THREE.MeshPhysicalMaterial,
  opacity: number
): void {
  const clamped = clamp01(opacity);
  const needsAlpha = clamped < 0.99;
  if (material.transparent !== needsAlpha) {
    material.transparent = needsAlpha;
    material.depthWrite = !needsAlpha;
    material.needsUpdate = true;
  }
  material.opacity = clamped;
}

/**
 * Conformal Cuticle & Sulcus Contact AO Shadow Material (`V9`):
 * Generates a subtle warm rosy-brown radial/U-groove shadow texture ONCE
 * with `MultiplyBlending`, `transparent: true`, `depthWrite: false`,
 * `premultipliedAlpha: false`, `side: THREE.FrontSide` to organically fuse the nail plate into skin.
 */
export function createCuticleContactSkirtMaterial(): CuticleSkirtMaterialBundle {
  const size = SKIRT_TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Neutral white base for MultiplyBlending (1.0 = no darkening, lower = subtle warm skin shadow)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);

    const img = ctx.getImageData(0, 0, size, size);
    const data = img.data;

    for (let y = 0; y < size; y++) {
      // Canvas top (y = 0) corresponds to UV v = 1 (end of nail bed, v_nail = 0.58)
      // Canvas bottom (y = size - 1) corresponds to UV v = 0 (proximal skin outside cuticle, v_nail = -0.04)
      const vNorm = 1 - y / (size - 1);

      // Cuticle lunula band peaks near v_nail ≈ 0.02 (vNorm ≈ 0.097) and fades softly to 0 at edges
      const cuticleCenter = 0.10;
      const cuticleDist = (vNorm - cuticleCenter) / 0.14;
      const cuticleShadow = Math.exp(-cuticleDist * cuticleDist * 2.2) * 0.42;

      // Lateral sulcus groove shadow runs softly along v_nail ∈ [0, 0.58] and feathers out at distal bed end
      const bedEnvelope =
        smoothFalloff(vNorm, 0.02, 0.18) * (1 - smoothFalloff(vNorm, 0.72, 1.0));

      for (let x = 0; x < size; x++) {
        const u = x / (size - 1);
        const s = Math.abs(u * 2 - 1); // 0 at center, 1 at outer skirt rim

        // Sulcus shadow concentrates along inner lateral fold (s ∈ [0.68, 0.96]) and fades cleanly to 0 at rim s=1
        const lateralDist = (s - 0.84) / 0.12;
        const lateralRidge =
          Math.exp(-lateralDist * lateralDist * 2.4) * (1 - smoothFalloff(s, 0.92, 1.0));
        const lateralShadow = lateralRidge * bedEnvelope * 0.34;

        // Combine cuticle & lateral groove occlusion, feathering cleanly to zero at outer boundary
        const outerEdgeFeather =
          1 - smoothFalloff(s, 0.90, 1.0) * 0.85;
        const proximalFeather = smoothFalloff(vNorm, 0.0, 0.09);
        const shadow = clamp01(
          (cuticleShadow * (1 - smoothFalloff(s, 0.84, 1.0)) + lateralShadow) *
            outerEdgeFeather *
            proximalFeather
        );

        // Warm rosy-brown AO tint (darker in B/G than R so skin shadow never turns muddy gray)
        const r = Math.round(255 * (1 - shadow * 0.42));
        const g = Math.round(255 * (1 - shadow * 0.64));
        const b = Math.round(255 * (1 - shadow * 0.68));
        const a = Math.round(255 * clamp01(shadow * 1.45));

        const idx = (y * size + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    blending: THREE.MultiplyBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    premultipliedAlpha: false,
    side: THREE.FrontSide,
  });

  return { material, texture };
}

function smoothFalloff(x: number, edge0: number, edge1: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function paintUndersideColorCanvas(canvas: HTMLCanvasElement, baseColorHex: string): void {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const polish = parseHexToRgb(baseColorHex);
  // Warm translucent ivory base (#E6D5C8)
  const ivory = { r: 230, g: 213, b: 200 };
  // ~30% dorsal polish tint blended into natural translucent warm ivory
  const freeEdgeTint = {
    r: ivory.r * 0.70 + polish.r * 0.30,
    g: ivory.g * 0.70 + polish.g * 0.30,
    b: ivory.b * 0.70 + polish.b * 0.30,
  };
  const midTint = {
    r: freeEdgeTint.r * 0.88 + 165 * 0.12,
    g: freeEdgeTint.g * 0.85 + 110 * 0.15,
    b: freeEdgeTint.b * 0.84 + 98 * 0.16,
  };

  // Canvas y = 0 corresponds to UV v = 1 (distal free tip)
  // Canvas y = size corresponds to UV v = 0 (hyponychium pocket)
  // First 45% (v ∈ [0, 0.45] => y ∈ [0.55*size, size]): deep warm hyponychium shadow #3A1D18 -> #7A463B
  // Free edge (v ∈ [0.45, 1.0] => y ∈ [0, 0.55*size]): tinted translucent warm ivory
  const baseGrad = ctx.createLinearGradient(0, 0, 0, size);
  baseGrad.addColorStop(0.0, rgbCss(freeEdgeTint.r, freeEdgeTint.g, freeEdgeTint.b));
  baseGrad.addColorStop(0.32, rgbCss(midTint.r, midTint.g, midTint.b));
  baseGrad.addColorStop(0.55, '#8E5649'); // transition out of hyponychium pocket (v = 0.45)
  baseGrad.addColorStop(0.76, '#7A463B');
  baseGrad.addColorStop(1.0, '#3A1D18'); // deep hyponychium fold (v = 0)
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, size, size);

  // Subtle longitudinal natural keratin/gel striations
  for (let x = 0; x < size; x += 2) {
    const wave = Math.sin(x * 0.42) * 0.5 + Math.cos(x * 1.1) * 0.5;
    const alpha = 0.02 + Math.abs(wave) * 0.018;
    ctx.fillStyle =
      wave >= 0 ? `rgba(255, 245, 238, ${alpha})` : `rgba(88, 46, 38, ${alpha})`;
    ctx.fillRect(x, 0, 1, size);
  }

  // Deep C-curve sidewall pocket shading near u = 0 and u = 1
  const sideGrad = ctx.createLinearGradient(0, 0, size, 0);
  sideGrad.addColorStop(0.0, 'rgba(42, 20, 16, 0.65)');
  sideGrad.addColorStop(0.14, 'rgba(68, 35, 28, 0.28)');
  sideGrad.addColorStop(0.32, 'rgba(72, 38, 32, 0.05)');
  sideGrad.addColorStop(0.50, 'rgba(72, 38, 32, 0.0)');
  sideGrad.addColorStop(0.68, 'rgba(72, 38, 32, 0.05)');
  sideGrad.addColorStop(0.86, 'rgba(68, 35, 28, 0.28)');
  sideGrad.addColorStop(1.0, 'rgba(42, 20, 16, 0.65)');
  ctx.fillStyle = sideGrad;
  ctx.fillRect(0, 0, size, size);
}

function createUndersideAOCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    const v = 1 - y / (size - 1); // 0 = hyponychium base, 1 = free tip
    // Strong occlusion in the first 45% (hyponychium pocket), easing smoothly into the C-tunnel
    const vOcc = v < 0.45 ? 0.38 + 0.62 * smoothFalloff(v, 0.0, 0.45) : 1.0;

    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const s = Math.abs(u * 2 - 1); // 0 center .. 1 sidewall
      // Strong occlusion on C-curve lateral walls near u = 0 and u = 1
      const sideOcc = 1.0 - 0.66 * Math.pow(s, 2.2);
      const ao = Math.round(255 * clamp01(vOcc * sideOcc));

      const idx = (y * size + x) * 4;
      data[idx] = ao;
      data[idx + 1] = ao;
      data[idx + 2] = ao;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Concave Underside Material Bundle (`V9`):
 * Built once outside RAF; call `updateUndersideMaterialTint` only when dorsal `baseColorHex` changes.
 */
export function createUndersideNailMaterial(
  envMap: THREE.Texture | null,
  initialBaseColor = '#E6D5C8'
): UndersideMaterialBundle {
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = UNDERSIDE_TEX_SIZE;
  colorCanvas.height = UNDERSIDE_TEX_SIZE;
  paintUndersideColorCanvas(colorCanvas, initialBaseColor);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.needsUpdate = true;

  const aoCanvas = createUndersideAOCanvas(UNDERSIDE_TEX_SIZE);
  const aoMap = new THREE.CanvasTexture(aoCanvas);
  aoMap.colorSpace = THREE.NoColorSpace;
  aoMap.wrapS = THREE.ClampToEdgeWrapping;
  aoMap.wrapT = THREE.ClampToEdgeWrapping;
  aoMap.needsUpdate = true;

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff'),
    map,
    aoMap,
    aoMapIntensity: 1.2,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.28,
    ior: 1.48,
    envMap,
    envMapIntensity: 0.72,
    transparent: false,
    opacity: 1.0,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
  });

  const bundle: UndersideMaterialBundle = {
    material,
    map,
    aoMap,
    baseColor: initialBaseColor,
    dispose: () => {
      material.dispose();
      map.dispose();
      aoMap.dispose();
    },
  };

  return bundle;
}

/**
 * Updates the underside free-edge translucency tint (~30% dorsal polish color + warm ivory `#E6D5C8`)
 * strictly on design color change (never on every RAF frame).
 */
export function updateUndersideMaterialTint(
  bundle: UndersideMaterialBundle,
  baseColorHex: string
): void {
  const normalized = baseColorHex.trim().toUpperCase();
  if (bundle.baseColor.toUpperCase() === normalized) return;

  const canvas = bundle.map.image as HTMLCanvasElement | undefined;
  if (!canvas || typeof canvas.getContext !== 'function') return;

  paintUndersideColorCanvas(canvas, baseColorHex);
  bundle.map.needsUpdate = true;
  bundle.baseColor = baseColorHex;
}

// Reusable 48×48 mini-canvas for single-readback directional skin light estimation
const DIR_SAMPLER_SIZE = 48;
let dirSamplerCanvas: HTMLCanvasElement | null = null;
let dirSamplerCtx: CanvasRenderingContext2D | null = null;

function sampleRegionMeanFromImageData(
  imageData: ImageData,
  normX: number,
  normY: number,
  radiusPx: number
): { r: number; g: number; b: number; luma: number } {
  const { width, height, data } = imageData;
  const cx = clamp01(normX) * (width - 1);
  const cy = clamp01(normY) * (height - 1);
  const minX = Math.max(0, Math.floor(cx - radiusPx));
  const maxX = Math.min(width - 1, Math.ceil(cx + radiusPx));
  const minY = Math.max(0, Math.floor(cy - radiusPx));
  const maxY = Math.min(height - 1, Math.ceil(cy + radiusPx));

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * width;
    for (let x = minX; x <= maxX; x++) {
      const idx = (rowOffset + x) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      count += 1;
    }
  }

  if (count === 0) {
    return { r: 0.78, g: 0.63, b: 0.54, luma: 0.66 };
  }

  const nr = r / count / 255;
  const ng = g / count / 255;
  const nb = b / count / 255;
  const luma = 0.299 * nr + 0.587 * ng + 0.114 * nb;
  return { r: nr, g: ng, b: nb, luma };
}

function computeDirectionalSampleFromPatches(
  center: { r: number; g: number; b: number; luma: number },
  left: { r: number; g: number; b: number; luma: number },
  right: { r: number; g: number; b: number; luma: number },
  prevSample: DirectionalAmbientLightSample
): DirectionalAmbientLightSample {
  // Differential luminance between right and left flanks estimates key light azimuth (-1 .. +1)
  const lrDiff = right.luma - left.luma;
  const avgLuma = Math.max(0.08, (center.luma + left.luma + right.luma) / 3);
  const rawAzimuthX = Math.max(-1, Math.min(1, (lrDiff / avgLuma) * 2.4));

  // Longitudinal brightness contrast nudges elevation (0.15 .. 0.95)
  const centerContrast = (center.luma - (left.luma + right.luma) * 0.5) / avgLuma;
  const rawElevationY = Math.max(0.15, Math.min(0.95, 0.55 + centerContrast * 1.4));

  const alpha = 0.14;
  return {
    r: prevSample.r + (center.r - prevSample.r) * alpha,
    g: prevSample.g + (center.g - prevSample.g) * alpha,
    b: prevSample.b + (center.b - prevSample.b) * alpha,
    luma: prevSample.luma + (center.luma - prevSample.luma) * alpha,
    lightAzimuthX:
      prevSample.lightAzimuthX + (rawAzimuthX - prevSample.lightAzimuthX) * alpha,
    lightElevationY:
      prevSample.lightElevationY + (rawElevationY - prevSample.lightElevationY) * alpha,
  };
}

/**
 * Zero-DOM/zero-WebGL-stall directional skin light estimator operating directly on an
 * already-captured `ImageData` buffer (e.g. shared `64×64` readback from `ARCameraCanvas`
 * + `LiveFingerCalibrator` or a `48×48` capture).
 */
export function sampleDirectionalLightFromImageData(
  imageData: ImageData,
  landmarks: NormalizedPoint[],
  rect: { drawX: number; drawY: number; drawW: number; drawH: number },
  cssW: number,
  cssH: number,
  mirrorX: boolean,
  prevSample: DirectionalAmbientLightSample
): DirectionalAmbientLightSample {
  if (
    !imageData ||
    imageData.width <= 0 ||
    imageData.height <= 0 ||
    landmarks.length < 13 ||
    cssW <= 0 ||
    cssH <= 0
  ) {
    return prevSample;
  }

  // Reference middle phalanx (PIP=10 -> DIP=11) or fallback to index phalanx (PIP=6 -> DIP=7)
  const pip = landmarks[10] ?? landmarks[6];
  const dip = landmarks[11] ?? landmarks[7];
  if (!pip || !dip) return prevSample;

  const toBufferNorm = (lmX: number, lmY: number): { u: number; v: number } => {
    const rawCssX = rect.drawX + lmX * rect.drawW;
    const cssX = mirrorX ? cssW - rawCssX : rawCssX;
    const cssY = rect.drawY + lmY * rect.drawH;
    return {
      u: clamp01(cssX / cssW),
      v: clamp01(cssY / cssH),
    };
  };

  const pPip = toBufferNorm(pip.x, pip.y);
  const pDip = toBufferNorm(dip.x, dip.y);

  const cx = (pPip.u + pDip.u) * 0.5;
  const cy = (pPip.v + pDip.v) * 0.5;

  const dx = pDip.u - pPip.u;
  const dy = pDip.v - pPip.v;
  const segLen = Math.max(0.015, Math.hypot(dx, dy));
  const ux = dx / segLen;
  const uy = dy / segLen;
  const px = -uy;
  const py = ux;
  const lateralOffset = Math.max(0.008, Math.min(0.028, segLen * 0.34));
  const radiusPx = Math.max(1, Math.round(Math.min(imageData.width, imageData.height) * 0.025));

  const center = sampleRegionMeanFromImageData(imageData, cx, cy, radiusPx);
  const left = sampleRegionMeanFromImageData(
    imageData,
    cx - px * lateralOffset,
    cy - py * lateralOffset,
    radiusPx
  );
  const right = sampleRegionMeanFromImageData(
    imageData,
    cx + px * lateralOffset,
    cy + py * lateralOffset,
    radiusPx
  );

  return computeDirectionalSampleFromPatches(center, left, right, prevSample);
}

/**
 * Samples ambient skin color/luminance AND room directional light azimuth/elevation
 * using at most **1 single `drawImage` + 1 single `getImageData`** on a compact `48×48` canvas
 * (eliminating the 3× synchronous GPU pipeline stalls per frame).
 */
export function sampleDirectionalSkinLight(
  source: HTMLVideoElement | HTMLImageElement,
  landmarks: NormalizedPoint[],
  prevSample: DirectionalAmbientLightSample
): DirectionalAmbientLightSample {
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!srcW || !srcH || landmarks.length < 13) return prevSample;

  if (!dirSamplerCanvas) {
    dirSamplerCanvas = document.createElement('canvas');
    dirSamplerCanvas.width = DIR_SAMPLER_SIZE;
    dirSamplerCanvas.height = DIR_SAMPLER_SIZE;
    dirSamplerCtx = dirSamplerCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!dirSamplerCtx) return prevSample;

  try {
    // Single 48×48 drawImage + single getImageData GPU readback
    dirSamplerCtx.drawImage(source, 0, 0, DIR_SAMPLER_SIZE, DIR_SAMPLER_SIZE);
    const frameImageData = dirSamplerCtx.getImageData(
      0,
      0,
      DIR_SAMPLER_SIZE,
      DIR_SAMPLER_SIZE
    );
    return sampleDirectionalLightFromImageData(
      frameImageData,
      landmarks,
      { drawX: 0, drawY: 0, drawW: 1, drawH: 1 },
      1,
      1,
      false,
      prevSample
    );
  } catch {
    return prevSample;
  }
}

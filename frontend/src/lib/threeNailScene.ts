import * as THREE from 'three';
import { createVolumetricNailGeometry, evalNailHalfWidth } from './nail3DGeometry';
import {
  ORDERED_FINGERS,
  buildFingerSpecsFromStudioDesign,
  type NailFingerDesignSpec,
} from './perFingerVisionAnalyzer';
import {
  type ProceduralPBRBundle,
  synthesizeProceduralPBRBundle,
} from './proceduralPBRSynthesizer';
import type { ImageLayoutRect } from './nailRenderer';
import type {
  FingerId,
  FingerPose,
  NailAdjustment,
  NailDesign,
  NailShape,
} from '../types/nail';

export interface AmbientLightSample {
  /** Normalized skin/room tint RGB (0..1) */
  r: number;
  g: number;
  b: number;
  /** Normalized room luminance (0..1) */
  luma: number;
}

const SHAPE_LENGTH_MULT: Record<NailShape, number> = {
  natural: 0.9,
  square: 1.02,
  almond: 1.1,
  coffin: 1.18,
  stiletto: 1.26,
};

const ANATOMICAL_DISTAL_METERS: Record<FingerId, number> = {
  thumb: 0.029,
  index: 0.021,
  middle: 0.023,
  ring: 0.021,
  pinky: 0.0175,
};

const ANATOMICAL_WIDTH_METERS: Record<FingerId, number> = {
  thumb: 0.0175,
  index: 0.0138,
  middle: 0.0144,
  ring: 0.0132,
  pinky: 0.0108,
};

const PALM_WRIST_TO_MIDDLE_MCP_METERS = 0.085;

/**
 * Generates an in-memory Softbox Studio Environment Map using THREE.PMREMGenerator
 * (zero external HDRI network calls, works 100% offline!).
 */
function createStudioEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x181316);

  // Overhead warm beauty softbox strip
  const softboxGeo = new THREE.PlaneGeometry(14, 7);
  const softboxMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.6, 2.45, 2.32),
    side: THREE.DoubleSide,
  });
  const topSoftbox = new THREE.Mesh(softboxGeo, softboxMat);
  topSoftbox.position.set(-1.5, 6.5, 5.0);
  topSoftbox.lookAt(0, 0, 0);
  envScene.add(topSoftbox);

  // Secondary cool/neutral side rim light panel for glossy gel edge catchlights
  const rimGeo = new THREE.PlaneGeometry(6, 12);
  const rimMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.45, 1.5, 1.65),
    side: THREE.DoubleSide,
  });
  const sidePanel = new THREE.Mesh(rimGeo, rimMat);
  sidePanel.position.set(7.0, 1.0, 3.0);
  sidePanel.lookAt(0, 0, 0);
  envScene.add(sidePanel);

  // Warm rose-gold bounce floor
  const floorGeo = new THREE.PlaneGeometry(18, 18);
  const floorMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.55, 0.38, 0.34),
    side: THREE.DoubleSide,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(0, -6.5, 0);
  floor.rotation.x = -Math.PI / 2;
  envScene.add(floor);

  const envRT = pmrem.fromScene(envScene, 0.035);

  softboxGeo.dispose();
  softboxMat.dispose();
  rimGeo.dispose();
  rimMat.dispose();
  floorGeo.dispose();
  floorMat.dispose();
  pmrem.dispose();

  return envRT.texture;
}

/**
 * Generates a soft elliptical warm ambient-occlusion shadow texture (`rgba(26,12,12,0.34)`)
 * seated strictly beneath each nail bed (`renderOrder: 1`).
 */
function createAOShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const grad = ctx.createRadialGradient(
      size * 0.5,
      size * 0.5,
      size * 0.06,
      size * 0.5,
      size * 0.5,
      size * 0.48
    );
    grad.addColorStop(0, 'rgba(26, 12, 12, 0.34)');
    grad.addColorStop(0.55, 'rgba(26, 12, 12, 0.18)');
    grad.addColorStop(1, 'rgba(26, 12, 12, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a dedicated 256×256 procedural underside occlusion + milky translucent gel texture ONCE
 * at initialization (never inside RAF):
 * - Warm deep skin-contact AO shadow near hyponychium base (v -> 0, canvas bottom) and inner lateral margins
 * - Smooth gradient lightening to natural milky rosy-pearl translucent gel with subtle longitudinal striations (v -> 1, canvas top)
 */
function createUndersideOcclusionTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Base longitudinal gradient: v=1 (top of canvas, free tip) -> v=0 (bottom of canvas, hyponychium/skin base)
    const baseGrad = ctx.createLinearGradient(0, 0, 0, size);
    baseGrad.addColorStop(0.0, '#FBF3EE'); // Milky pearl translucent free edge (v = 1)
    baseGrad.addColorStop(0.38, '#F2DFD5'); // Soft rosy cream gel body
    baseGrad.addColorStop(0.72, '#C89888'); // Warm translucent transition near hyponychium
    baseGrad.addColorStop(0.9, '#8E5A4D'); // Deep warm skin-pocket AO shadow
    baseGrad.addColorStop(1.0, '#5E362E'); // Hyponychium crease occlusion (v = 0)
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, size, size);

    // Subtle longitudinal micro-striations along v for authentic sculpted gel/nail underside fiber depth
    for (let x = 0; x < size; x += 2) {
      const wave = Math.sin(x * 0.45) * 0.5 + Math.cos(x * 1.15) * 0.5;
      const alpha = 0.028 + Math.abs(wave) * 0.022;
      ctx.fillStyle = wave >= 0 ? `rgba(255, 250, 246, ${alpha})` : `rgba(110, 68, 58, ${alpha})`;
      ctx.fillRect(x, 0, 1, size);
    }

    // Soft lateral inner-margin occlusion darkening along u=0 and u=1 (C-curve sidewall shadow)
    const sideGrad = ctx.createLinearGradient(0, 0, size, 0);
    sideGrad.addColorStop(0.0, 'rgba(68, 36, 30, 0.52)');
    sideGrad.addColorStop(0.14, 'rgba(84, 46, 38, 0.16)');
    sideGrad.addColorStop(0.35, 'rgba(84, 46, 38, 0.0)');
    sideGrad.addColorStop(0.65, 'rgba(84, 46, 38, 0.0)');
    sideGrad.addColorStop(0.86, 'rgba(84, 46, 38, 0.16)');
    sideGrad.addColorStop(1.0, 'rgba(68, 36, 30, 0.52)');
    ctx.fillStyle = sideGrad;
    ctx.fillRect(0, 0, size, size);

    // Warm radial hyponychium pocket AO at bottom-center (v -> 0)
    const hyponychiumAO = ctx.createRadialGradient(
      size * 0.5,
      size * 1.02,
      size * 0.05,
      size * 0.5,
      size * 0.92,
      size * 0.58
    );
    hyponychiumAO.addColorStop(0.0, 'rgba(52, 24, 20, 0.58)');
    hyponychiumAO.addColorStop(0.55, 'rgba(78, 38, 32, 0.24)');
    hyponychiumAO.addColorStop(1.0, 'rgba(78, 38, 32, 0.0)');
    ctx.fillStyle = hyponychiumAO;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Adaptive One-Euro Filter (Casiez et al.) with optional sub-pixel deadband
 * to eliminate micro-jitter at rest while preserving near-zero latency during fast hand movement.
 */
class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private initialized = false;
  private xPrev = 0;
  private dxPrev = 0;

  constructor(minCutoff = 1.2, beta = 0.05, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static alpha(dt: number, cutoff: number): number {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / Math.max(1e-4, dt));
  }

  public reset(): void {
    this.initialized = false;
    this.xPrev = 0;
    this.dxPrev = 0;
  }

  public filter(x: number, dt: number, deadband = 0): number {
    if (!this.initialized || dt <= 0) {
      this.initialized = true;
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }

    const safeDt = Math.max(1e-4, dt);
    const delta = x - this.xPrev;
    // Soft sub-pixel deadband suppresses stationary MediaPipe micro-oscillations without step artifacts
    const effectiveDelta =
      deadband > 0 && Math.abs(delta) < deadband
        ? delta * (Math.abs(delta) / deadband) * 0.2
        : delta;
    const targetX = this.xPrev + effectiveDelta;

    const dx = effectiveDelta / safeDt;
    const aD = OneEuroFilter.alpha(safeDt, this.dCutoff);
    const dxHat = aD * dx + (1.0 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter.alpha(safeDt, cutoff);
    const xHat = a * targetX + (1.0 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

interface PhalanxOccluderRig {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

interface FingerRig {
  nailMesh: THREE.Mesh;
  dorsalMaterial: THREE.MeshPhysicalMaterial;
  aoShadowMesh: THREE.Mesh;
  aoShadowMaterial: THREE.MeshBasicMaterial;
  proximalOccluder: PhalanxOccluderRig;
  middleOccluder: PhalanxOccluderRig;
  distalOccluder: PhalanxOccluderRig;
  currentSpecHash: string;
  initialized: boolean;
  posFilters: [OneEuroFilter, OneEuroFilter, OneEuroFilter];
  scaleFilters: [OneEuroFilter, OneEuroFilter, OneEuroFilter];
  currentPos: THREE.Vector3;
  currentQuat: THREE.Quaternion;
  currentScale: THREE.Vector3;
  filteredDorsalNormal: THREE.Vector3;
}

/**
 * Three.js + Procedural V5 Per-Finger PBR 3D Nail Scene Engine:
 * - Strictly 1 unique volumetric 3D nail rig per finger (`Map<FingerId, FingerRig>` with exactly 5 rigs)
 * - Multi-material volumetric geometry:
 *   Group 0 = Dorsal sculpted gel shell + closed lateral/free-edge walls (per-finger 1024×1024 PBR MeshPhysicalMaterial)
 *   Group 1 = Concave hollowed translucent milky-gel underside (`#F0E2D8`, `DoubleSide`)
 * - Subtle warm AO contact shadow skirt (`renderOrder: 2`, `depthWrite: false`) beneath each nail
 * - 3 invisible physical phalanx depth occluder cylinders per finger (`MCP->PIP`, `PIP->DIP`, `DIP->TIP`, `renderOrder: 1`,
 *   `colorWrite: false, depthWrite: true`) centered on the 3D phalanx axes and ending exactly at `TIP`
 *   for accurate cross-finger occlusion and palm-facing underside reveal!
 */
export class ThreeNailScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private envMap: THREE.Texture | null = null;

  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;

  private geometries = new Map<NailShape, THREE.BufferGeometry>();
  private undersideTexture: THREE.CanvasTexture;
  private undersideMaterial: THREE.MeshPhysicalMaterial;
  private aoShadowGeometry: THREE.PlaneGeometry;
  private aoShadowTexture: THREE.CanvasTexture;
  private occluderMaterial: THREE.MeshBasicMaterial;
  private occluderGeometry: THREE.CapsuleGeometry;

  private fingerRigs = new Map<FingerId, FingerRig>();
  private handScaleFilter = new OneEuroFilter(0.9, 0.03, 1.0);
  private ready = false;

  // Design & PBR bundle cache — ensures zero texture creation or canvas drawing inside RAF
  private activeDesignKey = '';
  private cachedFingerSpecs: Record<FingerId, NailFingerDesignSpec> | null = null;
  private cachedPBRBundles = new Map<FingerId, ProceduralPBRBundle>();

  // Reusable math scratch objects (zero per-frame GC churn at 60fps)
  private tmpTip = new THREE.Vector3();
  private tmpDip = new THREE.Vector3();
  private tmpPip = new THREE.Vector3();
  private tmpMcp = new THREE.Vector3();
  private tmpWrist = new THREE.Vector3();
  private tmpCuticle = new THREE.Vector3();
  private tmpPalmNormal = new THREE.Vector3();
  private tmpAxisY = new THREE.Vector3();
  private tmpAxisX = new THREE.Vector3();
  private tmpAxisZ = new THREE.Vector3();
  private tmpMatrix = new THREE.Matrix4();
  private tmpTargetQuat = new THREE.Quaternion();
  private tmpRotOffsetQuat = new THREE.Quaternion();
  private tmpTargetPos = new THREE.Vector3();
  private tmpTargetScale = new THREE.Vector3();
  private tmpOccStart = new THREE.Vector3();
  private tmpOccEnd = new THREE.Vector3();
  private tmpOccDir = new THREE.Vector3();
  private tmpOccCenter = new THREE.Vector3();
  private tmpOccQuat = new THREE.Quaternion();
  private tmpOccUp = new THREE.Vector3(0, 1, 0);
  private tmpAoPos = new THREE.Vector3();
  private tmpVecA = new THREE.Vector3();
  private tmpVecB = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    // Right-handed 1:1 pixel OrthographicCamera: left=0, right=cssW, top=cssH, bottom=0, near=-1000, far=1000
    // det(Projection) > 0 preserves Three.js FrontSide winding without inversion.
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1000, 1000);
    this.camera.position.set(0, 0, 500);
    this.camera.lookAt(0, 0, 0);

    this.dirLight = new THREE.DirectionalLight(0xfff6ef, 1.55);
    this.dirLight.position.set(-220, 380, 760);
    this.scene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight(0xf3e8ff, 0.65);
    this.rimLight.position.set(340, -140, 520);
    this.scene.add(this.rimLight);

    this.hemiLight = new THREE.HemisphereLight(0xfff5ee, 0x5c3e36, 1.15);
    this.scene.add(this.hemiLight);

    // Group 1 Material: Concave hollowed translucent milky-gel underside with internal AO occlusion map
    this.undersideTexture = createUndersideOcclusionTexture();
    this.undersideMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#FFFFFF'),
      map: this.undersideTexture,
      roughness: 0.28,
      metalness: 0.0,
      clearcoat: 0.45,
      clearcoatRoughness: 0.24,
      ior: 1.48,
      reflectivity: 0.45,
      transparent: true,
      opacity: 0.92,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });

    this.aoShadowGeometry = new THREE.PlaneGeometry(1.06, 0.98);
    this.aoShadowTexture = createAOShadowTexture();

    this.occluderMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });
    // CapsuleGeometry(0.5, 1.0): base radius = 0.5, base total height = 2.0 -> scaleXZ = radius * 2, scaleY = totalLen * 0.5
    this.occluderGeometry = new THREE.CapsuleGeometry(0.5, 1.0, 8, 16);

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      this.renderer = renderer;

      this.envMap = createStudioEnvironmentMap(renderer);
      this.scene.environment = this.envMap;

      const initialGeo = this.getOrCreateGeometry('almond');

      const makeOccluderRig = (): PhalanxOccluderRig => {
        const mesh = new THREE.Mesh(this.occluderGeometry, this.occluderMaterial);
        mesh.renderOrder = 1;
        mesh.visible = false;
        this.scene.add(mesh);
        return {
          mesh,
          pos: new THREE.Vector3(),
          quat: new THREE.Quaternion(),
        };
      };

      // Pre-allocate strictly 5 unique finger rigs (thumb, index, middle, ring, pinky)
      for (const id of ORDERED_FINGERS) {
        const proximalOccluder = makeOccluderRig();
        const middleOccluder = makeOccluderRig();
        const distalOccluder = makeOccluderRig();

        const aoShadowMaterial = new THREE.MeshBasicMaterial({
          map: this.aoShadowTexture,
          transparent: true,
          opacity: 1.0,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
        });

        const aoShadowMesh = new THREE.Mesh(this.aoShadowGeometry, aoShadowMaterial);
        aoShadowMesh.renderOrder = 2;
        aoShadowMesh.visible = false;
        this.scene.add(aoShadowMesh);

        const dorsalMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 1.0, // modulated by 1024x1024 roughnessMap
          metalness: 1.0, // modulated by 1024x1024 metalnessMap
          clearcoat: 1.0,
          clearcoatRoughness: 0.04,
          ior: 1.52,
          reflectivity: 0.92,
          envMapIntensity: 1.38,
          normalScale: new THREE.Vector2(1.15, 1.15),
          bumpScale: 0.028,
          transparent: true,
          depthWrite: true,
          depthTest: true,
          side: THREE.FrontSide,
        });

        const nailMesh = new THREE.Mesh(initialGeo, [dorsalMaterial, this.undersideMaterial]);
        nailMesh.renderOrder = 2;
        nailMesh.visible = false;
        this.scene.add(nailMesh);

        this.fingerRigs.set(id, {
          nailMesh,
          dorsalMaterial,
          aoShadowMesh,
          aoShadowMaterial,
          proximalOccluder,
          middleOccluder,
          distalOccluder,
          currentSpecHash: '',
          initialized: false,
          posFilters: [
            new OneEuroFilter(0.85, 0.04, 1.0), // X: locked 2D anchor with 0.35px deadband
            new OneEuroFilter(0.85, 0.04, 1.0), // Y: locked 2D anchor with 0.35px deadband
            new OneEuroFilter(0.65, 0.02, 1.0), // Z: strongly smoothed wrist-relative depth
          ],
          scaleFilters: [
            new OneEuroFilter(0.95, 0.03, 1.0),
            new OneEuroFilter(0.95, 0.03, 1.0),
            new OneEuroFilter(0.85, 0.025, 1.0),
          ],
          currentPos: new THREE.Vector3(),
          currentQuat: new THREE.Quaternion(),
          currentScale: new THREE.Vector3(1, 1, 1),
          filteredDorsalNormal: new THREE.Vector3(0, 0, 1),
        });
      }

      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  public isReady(): boolean {
    return this.ready && this.renderer !== null;
  }

  private getOrCreateGeometry(shape: NailShape): THREE.BufferGeometry {
    let geo = this.geometries.get(shape);
    if (!geo) {
      geo = createVolumetricNailGeometry(shape, 1.0);
      this.geometries.set(shape, geo);
    }
    return geo;
  }

  private syncViewport(cssW: number, cssH: number, dpr: number): void {
    const renderer = this.renderer;
    if (!renderer) return;

    const clampedDpr = Math.min(dpr, 1.5);
    const targetW = Math.max(1, Math.round(cssW * clampedDpr));
    const targetH = Math.max(1, Math.round(cssH * clampedDpr));
    const dom = renderer.domElement;
    if (dom.width !== targetW || dom.height !== targetH) {
      renderer.setPixelRatio(clampedDpr);
      renderer.setSize(cssW, cssH, false);
    }

    const safeW = Math.max(1, cssW);
    const safeH = Math.max(1, cssH);
    this.camera.left = 0;
    this.camera.right = safeW;
    this.camera.top = safeH;
    this.camera.bottom = 0;
    this.camera.near = -1000;
    this.camera.far = 1000;
    this.camera.position.set(0, 0, 500);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  private hideRig(rig: FingerRig): void {
    rig.nailMesh.visible = false;
    rig.aoShadowMesh.visible = false;
    rig.proximalOccluder.mesh.visible = false;
    rig.middleOccluder.mesh.visible = false;
    rig.distalOccluder.mesh.visible = false;
    if (rig.initialized) {
      rig.initialized = false;
      rig.posFilters[0].reset();
      rig.posFilters[1].reset();
      rig.posFilters[2].reset();
      rig.scaleFilters[0].reset();
      rig.scaleFilters[1].reset();
      rig.scaleFilters[2].reset();
      rig.filteredDorsalNormal.set(0, 0, 1);
    }
  }

  public clear(cssW: number, cssH: number, dpr: number): void {
    if (!this.renderer) return;
    this.syncViewport(cssW, cssH, dpr);
    for (const rig of this.fingerRigs.values()) {
      this.hideRig(rig);
    }
    this.handScaleFilter.reset();
    this.renderer.clear();
  }

  /**
   * Projects normalized MediaPipe landmark (x, y, z) 1:1 into Orthographic screen-pixel coordinates
   * accounting for exact `object-fit: cover` crop (`rect`), with `z` relative to wrist/base centered near 0.
   */
  private landmarkToScene(
    pt: { x: number; y: number; z?: number },
    rect: ImageLayoutRect,
    cssH: number,
    mirrorX: boolean,
    refZ: number,
    out: THREE.Vector3
  ): THREE.Vector3 {
    const nx = mirrorX ? 1 - pt.x : pt.x;
    const px = rect.drawX + nx * rect.drawW;
    const py = cssH - (rect.drawY + pt.y * rect.drawH);
    const pz = -((pt.z ?? 0) - refZ) * rect.drawW * 0.95;
    return out.set(px, py, pz);
  }

  private computeDesignKey(design: NailDesign): string {
    const fingerSpecsPart = design.fingerSpecs ? JSON.stringify(design.fingerSpecs) : '';
    return `${design.id}|${design.name}|${design.baseColor}|${design.secondaryColor ?? ''}|${design.accentColor ?? ''}|${design.finish}|${design.patternType}|${design.imageDataUrl ?? ''}|${fingerSpecsPart}`;
  }

  private paintMetallicOutlineOnBundle(
    bundle: ProceduralPBRBundle,
    shape: NailShape,
    outlineColor: string
  ): void {
    const traceSilhouette = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const steps = 40;
      ctx.beginPath();
      // Left edge from cuticle (v=0.05) to free tip (v=0.985)
      for (let i = 0; i <= steps; i++) {
        const v = 0.05 + (i / steps) * 0.935;
        const hw = evalNailHalfWidth(v, shape) * 0.91;
        const u = 0.5 - hw * 0.96;
        const x = u * w;
        const y = (1 - v) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Right edge from free tip (v=0.985) back to cuticle (v=0.05)
      for (let i = steps; i >= 0; i--) {
        const v = 0.05 + (i / steps) * 0.935;
        const hw = evalNailHalfWidth(v, shape) * 0.91;
        const u = 0.5 + hw * 0.96;
        const x = u * w;
        const y = (1 - v) * h;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const mapImg = bundle.map?.image as CanvasImageSource | undefined;
    if (mapImg && 'getContext' in mapImg && typeof mapImg.getContext === 'function') {
      const canvas = mapImg as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        traceSilhouette(ctx, canvas.width, canvas.height);
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = Math.max(10, canvas.width * 0.024);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 250, 236, 0.34)';
        ctx.lineWidth = Math.max(3, canvas.width * 0.007);
        ctx.stroke();
        ctx.restore();
        bundle.map.needsUpdate = true;
      }
    }

    const metalImg = bundle.metalnessMap?.image as CanvasImageSource | undefined;
    if (metalImg && 'getContext' in metalImg && typeof metalImg.getContext === 'function') {
      const canvas = metalImg as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        traceSilhouette(ctx, canvas.width, canvas.height);
        ctx.strokeStyle = '#EFEFEF';
        ctx.lineWidth = Math.max(10, canvas.width * 0.024);
        ctx.stroke();
        ctx.restore();
        bundle.metalnessMap.needsUpdate = true;
      }
    }

    const roughImg = bundle.roughnessMap?.image as CanvasImageSource | undefined;
    if (roughImg && 'getContext' in roughImg && typeof roughImg.getContext === 'function') {
      const canvas = roughImg as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        traceSilhouette(ctx, canvas.width, canvas.height);
        ctx.strokeStyle = '#1E1E1E';
        ctx.lineWidth = Math.max(10, canvas.width * 0.024);
        ctx.stroke();
        ctx.restore();
        bundle.roughnessMap.needsUpdate = true;
      }
    }
  }

  private ensureDesignPBRCache(design: NailDesign): void {
    const key = this.computeDesignKey(design);
    if (key === this.activeDesignKey && this.cachedFingerSpecs) {
      return;
    }

    this.activeDesignKey = key;
    const specs = buildFingerSpecsFromStudioDesign(design);
    this.cachedFingerSpecs = specs;
    this.cachedPBRBundles.clear();

    for (const id of ORDERED_FINGERS) {
      const spec = specs[id];
      const bundle = synthesizeProceduralPBRBundle(spec);

      // Paint metallic perimeter outline once inside cache (never inside RAF)
      if (spec.hasMetallicOutline && spec.outlineColor) {
        this.paintMetallicOutlineOnBundle(bundle, spec.shape, spec.outlineColor);
      }

      this.cachedPBRBundles.set(id, bundle);

      const rig = this.fingerRigs.get(id);
      if (rig && rig.currentSpecHash !== bundle.specHash) {
        rig.dorsalMaterial.map = bundle.map;
        rig.dorsalMaterial.normalMap = bundle.normalMap;
        rig.dorsalMaterial.bumpMap = bundle.bumpMap;
        rig.dorsalMaterial.roughnessMap = bundle.roughnessMap;
        rig.dorsalMaterial.metalnessMap = bundle.metalnessMap;
        rig.dorsalMaterial.alphaMap = bundle.alphaMap;
        rig.dorsalMaterial.needsUpdate = true;
        rig.currentSpecHash = bundle.specHash;

        const isRelief =
          spec.pattern === 'gold_3d_waves' ||
          spec.pattern === 'floral_accent' ||
          Boolean(spec.hasMetallicOutline);
        const isChrome = spec.pattern === 'chrome_mirror';
        const isVelvet = spec.glossIntensity < 0.65;

        const nScale = isRelief ? 1.55 : isChrome ? 0.85 : 1.05;
        rig.dorsalMaterial.normalScale.set(nScale, nScale);
        rig.dorsalMaterial.bumpScale = isRelief ? 0.042 : 0.018;
        rig.dorsalMaterial.clearcoat = isVelvet ? 0.42 : 1.0;
        rig.dorsalMaterial.clearcoatRoughness = isVelvet
          ? 0.34
          : isChrome
            ? 0.025
            : 0.04;
        rig.dorsalMaterial.envMapIntensity = isChrome
          ? 1.9
          : isVelvet
            ? 0.9
            : 1.4;
      }
    }
  }

  private updatePhalanxOccluder(
    occ: PhalanxOccluderRig,
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    slerpAlpha: number,
    initialized: boolean
  ): void {
    this.tmpOccStart.copy(start);
    this.tmpOccEnd.copy(end);
    this.tmpOccDir.copy(this.tmpOccEnd).sub(this.tmpOccStart);
    const totalLen = this.tmpOccDir.length();

    if (totalLen < 1.5) {
      occ.mesh.visible = false;
      return;
    }

    this.tmpOccDir.divideScalar(totalLen);
    this.tmpOccQuat.setFromUnitVectors(this.tmpOccUp, this.tmpOccDir);

    // CapsuleGeometry(0.5, 1.0): base radius = 0.5, base total height = 2.0
    // => scaleXZ = radius * 2, scaleY = totalLen * 0.5 centers capsule strictly between start & end
    this.tmpOccCenter
      .copy(this.tmpOccStart)
      .addScaledVector(this.tmpOccDir, totalLen * 0.5);

    if (!initialized) {
      occ.pos.copy(this.tmpOccCenter);
      occ.quat.copy(this.tmpOccQuat);
    } else {
      occ.pos.lerp(this.tmpOccCenter, Math.max(0.35, slerpAlpha));
      occ.quat.slerp(this.tmpOccQuat, Math.max(0.35, slerpAlpha));
    }

    occ.mesh.position.copy(occ.pos);
    occ.mesh.quaternion.copy(occ.quat);
    occ.mesh.scale.set(radius * 2, totalLen * 0.5, radius * 2);
    occ.mesh.visible = true;
  }

  public renderNails(
    cssW: number,
    cssH: number,
    dpr: number,
    rect: ImageLayoutRect,
    poses: FingerPose[],
    design: NailDesign,
    adjustment: NailAdjustment,
    ambient: AmbientLightSample,
    mirrorX = false,
    deltaTimeSec = 1 / 60
  ): void {
    const renderer = this.renderer;
    if (!renderer || !this.ready) return;

    this.syncViewport(cssW, cssH, dpr);
    if (poses.length === 0) {
      this.clear(cssW, cssH, dpr);
      return;
    }

    const dt = Math.min(0.05, Math.max(0.001, deltaTimeSec));

    // Synthesize / bind PBR textures ONLY when design or fingerSpecs actually change
    this.ensureDesignPBRCache(design);

    // Adaptive Scene Lighting synced with live skin RGB & luminance
    const lumExposure = Math.max(0.7, Math.min(1.35, 0.72 + ambient.luma * 0.85));
    this.hemiLight.color.setRGB(
      Math.min(1, 0.72 + ambient.r * 0.35),
      Math.min(1, 0.7 + ambient.g * 0.35),
      Math.min(1, 0.68 + ambient.b * 0.35)
    );
    this.hemiLight.groundColor.setRGB(
      ambient.r * 0.65,
      ambient.g * 0.55,
      ambient.b * 0.5
    );
    this.hemiLight.intensity = 0.95 * lumExposure;
    this.dirLight.intensity = 1.45 * lumExposure;
    renderer.toneMappingExposure = 0.95 + ambient.luma * 0.25;
    this.undersideMaterial.opacity = Math.min(0.92, adjustment.opacity * 0.96);

    const shapeMult = SHAPE_LENGTH_MULT[adjustment.shape] ?? 1.0;
    const geo = this.getOrCreateGeometry(adjustment.shape);
    const seenIds = new Set<FingerId>();

    // True anatomical hand scale (pxPerMeter) from 3D palm span wrist -> middle.mcp (~8.5 cm)
    // with median wrist -> finger.mcp fallback, smoothed via dedicated OneEuroFilter(0.9, 0.03).
    const middlePose = poses.find((p) => p.id === 'middle');
    const refWristZ =
      middlePose?.wrist?.z ??
      poses.find((p) => p.wrist)?.wrist?.z ??
      poses.find((p) => p.mcp)?.mcp?.z ??
      0;

    let rawPalmLen3D = 0;
    if (middlePose?.wrist && middlePose?.mcp) {
      this.landmarkToScene(middlePose.wrist, rect, cssH, mirrorX, refWristZ, this.tmpWrist);
      this.landmarkToScene(middlePose.mcp, rect, cssH, mirrorX, refWristZ, this.tmpMcp);
      rawPalmLen3D = this.tmpWrist.distanceTo(this.tmpMcp);
    }

    if (rawPalmLen3D < 8) {
      const palmSamples: number[] = [];
      for (const p of poses) {
        if (p.wrist && p.mcp) {
          this.landmarkToScene(p.wrist, rect, cssH, mirrorX, refWristZ, this.tmpWrist);
          this.landmarkToScene(p.mcp, rect, cssH, mirrorX, refWristZ, this.tmpMcp);
          const d = this.tmpWrist.distanceTo(this.tmpMcp);
          if (d >= 8) palmSamples.push(d);
        }
      }
      if (palmSamples.length > 0) {
        palmSamples.sort((a, b) => a - b);
        rawPalmLen3D = palmSamples[Math.floor(palmSamples.length / 2)];
      }
    }

    let rawPxPerMeter: number;
    if (rawPalmLen3D >= 8) {
      rawPxPerMeter = rawPalmLen3D / PALM_WRIST_TO_MIDDLE_MCP_METERS;
    } else {
      const fallbackPxPerM: number[] = [];
      for (const p of poses) {
        const pwZ = p.wrist?.z ?? refWristZ;
        this.landmarkToScene(p.tip, rect, cssH, mirrorX, pwZ, this.tmpTip);
        this.landmarkToScene(p.dip, rect, cssH, mirrorX, pwZ, this.tmpDip);
        const d3 = this.tmpTip.distanceTo(this.tmpDip);
        const distM = ANATOMICAL_DISTAL_METERS[p.id] ?? 0.021;
        if (d3 >= 4) fallbackPxPerM.push(d3 / distM);
      }
      if (fallbackPxPerM.length > 0) {
        fallbackPxPerM.sort((a, b) => a - b);
        rawPxPerMeter = fallbackPxPerM[Math.floor(fallbackPxPerM.length / 2)];
      } else {
        rawPxPerMeter = (rect.drawW * 0.24) / PALM_WRIST_TO_MIDDLE_MCP_METERS;
      }
    }

    const pxPerMeter = Math.max(
      180,
      Math.min(18000, this.handScaleFilter.filter(rawPxPerMeter, dt, 1.5))
    );

    for (const pose of poses) {
      const rig = this.fingerRigs.get(pose.id);
      // Strictly 1 unique rig per FingerId; ignore duplicate finger poses in the same frame
      if (!rig || seenIds.has(pose.id)) continue;

      rig.dorsalMaterial.opacity = adjustment.opacity;

      if (rig.nailMesh.geometry !== geo) {
        rig.nailMesh.geometry = geo;
      }

      const poseRefZ = pose.wrist?.z ?? refWristZ;

      // Project all 4 phalanx joints (MCP, PIP, DIP, TIP) 1:1 into Orthographic pixel space
      this.landmarkToScene(pose.tip, rect, cssH, mirrorX, poseRefZ, this.tmpTip);
      this.landmarkToScene(pose.dip, rect, cssH, mirrorX, poseRefZ, this.tmpDip);
      if (pose.pip) {
        this.landmarkToScene(pose.pip, rect, cssH, mirrorX, poseRefZ, this.tmpPip);
      } else {
        this.tmpPip
          .copy(this.tmpDip)
          .addScaledVector(this.tmpVecA.copy(this.tmpDip).sub(this.tmpTip), 1.25);
      }
      if (pose.mcp) {
        this.landmarkToScene(pose.mcp, rect, cssH, mirrorX, poseRefZ, this.tmpMcp);
      } else {
        this.tmpMcp
          .copy(this.tmpPip)
          .addScaledVector(this.tmpVecA.copy(this.tmpPip).sub(this.tmpDip), 1.35);
      }

      // Finger axis Y = normalize(TIP - DIP) in full 3D (x, y, z)
      // NEVER reject or scale based on dist2D(DIP, TIP) so pointing at the lens never triggers triangular explosion!
      this.tmpAxisY.copy(this.tmpTip).sub(this.tmpDip);
      const segLen3D = this.tmpAxisY.length();

      if (segLen3D < 3) {
        this.hideRig(rig);
        continue;
      }
      seenIds.add(pose.id);
      this.tmpAxisY.normalize();

      // True 3D dorsal palm normal (never forced toward +Z when palm turns to face camera!)
      if (pose.palmNormal) {
        if (mirrorX) {
          // Reflecting all 3 axes (-x, -y, -z) preserves cross product sign
          this.tmpPalmNormal.set(pose.palmNormal.x, pose.palmNormal.y, pose.palmNormal.z);
        } else {
          // Negating Y and Z preserves X sign and flips Y, Z of cross product
          this.tmpPalmNormal.set(pose.palmNormal.x, -pose.palmNormal.y, -pose.palmNormal.z);
        }

        // Convert vIndex x vPinky into outward dorsal normal (+Z local = back of hand, -Z local = palm)
        // for both Left/Right hands and mirrorX true/false
        if (((pose.handedness ?? 'Right') === 'Right') !== mirrorX) {
          this.tmpPalmNormal.negate();
        }

        if (this.tmpPalmNormal.lengthSq() < 1e-4) {
          this.tmpPalmNormal.set(0, 0, 1);
        } else {
          this.tmpPalmNormal.normalize();
        }
      } else if (pose.wrist) {
        this.landmarkToScene(pose.wrist, rect, cssH, mirrorX, poseRefZ, this.tmpWrist);
        this.tmpVecA.copy(this.tmpMcp).sub(this.tmpWrist);
        this.tmpVecB.copy(this.tmpPip).sub(this.tmpMcp);
        this.tmpPalmNormal.crossVectors(this.tmpVecA, this.tmpVecB);
        if (this.tmpPalmNormal.lengthSq() < 1e-4) {
          this.tmpPalmNormal.set(0, 0, 1);
        } else {
          this.tmpPalmNormal.normalize();
        }
      } else {
        this.tmpPalmNormal.set(0, 0, 1);
      }

      // Stabilize dorsalNormal via angular deadband (< 0.035 rad) + velocity-adaptive lerp
      if (!rig.initialized) {
        rig.filteredDorsalNormal.copy(this.tmpPalmNormal);
      } else {
        const dotN = Math.max(-1, Math.min(1, rig.filteredDorsalNormal.dot(this.tmpPalmNormal)));
        const angleN = Math.acos(dotN);
        const normalAlpha =
          angleN < 0.035
            ? 0.08
            : Math.min(0.78, 0.22 + ((angleN - 0.035) / 0.28) * 0.56);
        rig.filteredDorsalNormal.lerp(this.tmpPalmNormal, normalAlpha).normalize();
      }
      this.tmpPalmNormal.copy(rig.filteredDorsalNormal);

      // Gram-Schmidt right-handed orthonormal basis (det = +1):
      // Z = dorsalNormal orthogonalized against Y, X = normalize(Y × Z), Z = normalize(X × Y)
      this.tmpAxisZ
        .copy(this.tmpPalmNormal)
        .addScaledVector(this.tmpAxisY, -this.tmpPalmNormal.dot(this.tmpAxisY));
      if (this.tmpAxisZ.lengthSq() < 1e-4) {
        if (Math.abs(this.tmpAxisY.z) < 0.9) {
          this.tmpAxisZ.set(0, 0, 1);
        } else {
          this.tmpAxisZ.set(1, 0, 0);
        }
        this.tmpAxisZ
          .addScaledVector(this.tmpAxisY, -this.tmpAxisZ.dot(this.tmpAxisY))
          .normalize();
      } else {
        this.tmpAxisZ.normalize();
      }
      this.tmpAxisX.crossVectors(this.tmpAxisY, this.tmpAxisZ).normalize();
      // Re-orthogonalize Z = X × Y for exact right-handed orthonormal basis (det(M) = +1)
      this.tmpAxisZ.crossVectors(this.tmpAxisX, this.tmpAxisY).normalize();

      this.tmpMatrix.makeBasis(this.tmpAxisX, this.tmpAxisY, this.tmpAxisZ);
      this.tmpTargetQuat.setFromRotationMatrix(this.tmpMatrix);

      if (Math.abs(adjustment.rotationDeg) > 0.01) {
        this.tmpRotOffsetQuat.setFromAxisAngle(
          this.tmpAxisZ,
          (-adjustment.rotationDeg * Math.PI) / 180
        );
        this.tmpTargetQuat.premultiply(this.tmpRotOffsetQuat);
      }

      // Cuticle anchor strictly at lerp(DIP, TIP, 0.40)
      this.tmpCuticle.copy(this.tmpDip).lerp(this.tmpTip, 0.40);

      // True anatomical 3D nail sizing driven strictly by pxPerMeter & 3D distal length (zero 2D foreshortening distortion!)
      const fingerSpec = this.cachedFingerSpecs?.[pose.id];
      const specLengthMult = Math.max(
        0.85,
        Math.min(1.85, fingerSpec?.lengthMultiplier ?? fingerSpec?.relativeLength ?? 1.0)
      );

      const anatomicalW = pxPerMeter * (ANATOMICAL_WIDTH_METERS[pose.id] ?? 0.0138);
      const minSensibleW = Math.max(4.5, rect.drawW * 0.014);
      const maxSensibleW = rect.drawW * 0.22;
      const nailW = Math.max(
        minSensibleW,
        Math.min(maxSensibleW, anatomicalW * adjustment.scale)
      );

      const anatomicalDistal3D = pxPerMeter * (ANATOMICAL_DISTAL_METERS[pose.id] ?? 0.021);
      const stabilizedDistal3D = anatomicalDistal3D * 0.72 + segLen3D * 0.28;
      const clampedBaseH = Math.max(
        nailW * 1.12,
        Math.min(nailW * 2.45, stabilizedDistal3D * 0.92)
      );
      const nailH =
        clampedBaseH *
        specLengthMult *
        adjustment.scale *
        adjustment.extensionLength *
        shapeMult;
      const nailDepth = nailW;

      // Seat nail with 2mm cuticle embedding inside dorsal finger capsule while dorsal body clears capsule cleanly
      const distalOccluderRadius = 1.12 * (nailW * 0.5);
      const embed2mmPx = Math.min(
        distalOccluderRadius * 0.24,
        Math.max(1.5, 0.002 * pxPerMeter)
      );
      const dorsalOffset = distalOccluderRadius - embed2mmPx * 0.35;

      this.tmpTargetPos.copy(this.tmpCuticle).addScaledVector(this.tmpAxisZ, dorsalOffset);
      this.tmpTargetScale.set(nailW, nailH, nailDepth);

      // High-stability One-Euro Filter:
      // XY locked with minCutoff: 0.85, beta: 0.04, deadband: 0.35px
      // Z wrist-relative smoothed with minCutoff: 0.65, beta: 0.02, deadband: 0.45px
      const wasInitialized = rig.initialized;
      let slerpAlpha = 0.22;

      if (!wasInitialized) {
        rig.currentPos.set(
          rig.posFilters[0].filter(this.tmpTargetPos.x, dt),
          rig.posFilters[1].filter(this.tmpTargetPos.y, dt),
          rig.posFilters[2].filter(this.tmpTargetPos.z, dt)
        );
        rig.currentScale.set(
          rig.scaleFilters[0].filter(this.tmpTargetScale.x, dt),
          rig.scaleFilters[1].filter(this.tmpTargetScale.y, dt),
          rig.scaleFilters[2].filter(this.tmpTargetScale.z, dt)
        );
        rig.currentQuat.copy(this.tmpTargetQuat);
        rig.initialized = true;
      } else {
        const fx = rig.posFilters[0].filter(this.tmpTargetPos.x, dt, 0.35);
        const fy = rig.posFilters[1].filter(this.tmpTargetPos.y, dt, 0.35);
        const fz = rig.posFilters[2].filter(this.tmpTargetPos.z, dt, 0.45);
        const moveDist = Math.hypot(
          fx - rig.currentPos.x,
          fy - rig.currentPos.y,
          fz - rig.currentPos.z
        );
        rig.currentPos.set(fx, fy, fz);

        const scaleDeadband = Math.max(0.18, nailW * 0.006);
        rig.currentScale.set(
          rig.scaleFilters[0].filter(this.tmpTargetScale.x, dt, scaleDeadband),
          rig.scaleFilters[1].filter(this.tmpTargetScale.y, dt, scaleDeadband),
          rig.scaleFilters[2].filter(this.tmpTargetScale.z, dt, scaleDeadband)
        );

        const angleDelta = rig.currentQuat.angleTo(this.tmpTargetQuat);
        const posSpeed = moveDist / Math.max(1, nailW) / dt;
        const rotSpeed = angleDelta / dt;
        if (angleDelta < 0.035 && posSpeed < 0.65) {
          // Strong rotational damping when hand is still (< 0.035 rad) to eliminate jitter
          slerpAlpha = 0.09 + (angleDelta / 0.035) * 0.07;
        } else {
          // Low-latency adaptive slerp when hand turns deliberately
          const velocityNorm = Math.min(1, posSpeed * 0.16 + rotSpeed * 0.28);
          slerpAlpha = 0.24 + velocityNorm * (0.78 - 0.24);
        }
        rig.currentQuat.slerp(this.tmpTargetQuat, slerpAlpha);
      }

      rig.nailMesh.position.copy(rig.currentPos);
      rig.nailMesh.quaternion.copy(rig.currentQuat);
      rig.nailMesh.scale.copy(rig.currentScale);
      rig.nailMesh.visible = true;

      // Dorsal normal dotted with camera view vector (0, 0, 1) is simply this.tmpAxisZ.z
      const dorsalDotView = this.tmpAxisZ.z;

      // Subtle dorsal AO contact shadow skirt: fade out naturally when palm faces camera
      const aoOpacity = Math.max(0, Math.min(1, (dorsalDotView + 0.05) / 0.25));
      if (aoOpacity > 0.02) {
        this.tmpAoPos
          .copy(rig.currentPos)
          .addScaledVector(this.tmpAxisY, rig.currentScale.y * 0.46)
          .addScaledVector(this.tmpAxisZ, -nailW * 0.025);
        rig.aoShadowMesh.position.copy(this.tmpAoPos);
        rig.aoShadowMesh.quaternion.copy(rig.currentQuat);
        rig.aoShadowMesh.scale.set(rig.currentScale.x * 1.18, rig.currentScale.y * 0.94, 1);
        rig.aoShadowMaterial.opacity = aoOpacity;
        rig.aoShadowMesh.visible = true;
      } else {
        rig.aoShadowMesh.visible = false;
      }

      // 3 physical invisible CapsuleGeometry phalanx occluders per finger (`renderOrder: 1`)
      const fingerWidthRatio =
        (ANATOMICAL_WIDTH_METERS[pose.id] ?? 0.0138) / ANATOMICAL_WIDTH_METERS.index;
      const proximalRadius = distalOccluderRadius * 1.14 * Math.max(0.88, Math.min(1.12, fingerWidthRatio));
      const middleRadius = distalOccluderRadius * 1.06 * Math.max(0.9, Math.min(1.1, fingerWidthRatio));

      // 1. Proximal phalanx (MCP -> PIP)
      this.updatePhalanxOccluder(
        rig.proximalOccluder,
        this.tmpMcp,
        this.tmpPip,
        proximalRadius,
        slerpAlpha,
        wasInitialized
      );

      // 2. Middle phalanx (PIP -> DIP)
      this.updatePhalanxOccluder(
        rig.middleOccluder,
        this.tmpPip,
        this.tmpDip,
        middleRadius,
        slerpAlpha,
        wasInitialized
      );

      // 3. Distal phalanx (DIP -> TIP + 18%): extends +18% beyond TIP landmark to cover full fleshy fingertip pulp
      this.tmpVecA
        .copy(this.tmpDip)
        .addScaledVector(this.tmpVecB.copy(this.tmpTip).sub(this.tmpDip), 1.18);
      this.updatePhalanxOccluder(
        rig.distalOccluder,
        this.tmpDip,
        this.tmpVecA,
        distalOccluderRadius,
        slerpAlpha,
        wasInitialized
      );
    }

    for (const [id, rig] of this.fingerRigs.entries()) {
      if (!seenIds.has(id)) {
        this.hideRig(rig);
      }
    }

    renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    for (const geo of this.geometries.values()) {
      geo.dispose();
    }
    this.geometries.clear();

    for (const rig of this.fingerRigs.values()) {
      rig.dorsalMaterial.dispose();
      rig.aoShadowMaterial.dispose();
    }

    this.cachedPBRBundles.clear();
    this.aoShadowGeometry.dispose();
    this.aoShadowTexture.dispose();
    this.undersideTexture.dispose();
    this.undersideMaterial.dispose();
    this.occluderGeometry.dispose();
    this.occluderMaterial.dispose();
    this.envMap?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

// Lightweight reusable 8x8 sampler for real-time skin ambient light between PIP & DIP
let skinSamplerCanvas: HTMLCanvasElement | null = null;
let skinSamplerCtx: CanvasRenderingContext2D | null = null;

export function sampleFingerSkinAmbient(
  source: HTMLVideoElement | HTMLImageElement,
  poses: FingerPose[],
  prevSample: AmbientLightSample
): AmbientLightSample {
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!srcW || !srcH || poses.length === 0) return prevSample;

  if (!skinSamplerCanvas) {
    skinSamplerCanvas = document.createElement('canvas');
    skinSamplerCanvas.width = 8;
    skinSamplerCanvas.height = 8;
    skinSamplerCtx = skinSamplerCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!skinSamplerCtx) return prevSample;

  const refPose =
    poses.find((p) => p.id === 'middle') ?? poses.find((p) => p.id === 'index') ?? poses[0];

  const skinNormX = refPose.pip ? (refPose.dip.x + refPose.pip.x) * 0.5 : refPose.dip.x;
  const skinNormY = refPose.pip
    ? (refPose.dip.y + refPose.pip.y) * 0.5
    : Math.min(0.95, refPose.dip.y + 0.04);

  const patch = Math.max(8, Math.round(Math.min(srcW, srcH) * 0.028));
  const sx = Math.max(0, Math.min(srcW - patch, Math.round(skinNormX * srcW - patch / 2)));
  const sy = Math.max(0, Math.min(srcH - patch, Math.round(skinNormY * srcH - patch / 2)));

  try {
    skinSamplerCtx.drawImage(source, sx, sy, patch, patch, 0, 0, 8, 8);
    const { data } = skinSamplerCtx.getImageData(0, 0, 8, 8);
    let r = 0;
    let g = 0;
    let b = 0;
    const count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const nr = r / count / 255;
    const ng = g / count / 255;
    const nb = b / count / 255;
    const nluma = 0.299 * nr + 0.587 * ng + 0.114 * nb;

    const alpha = 0.14;
    return {
      r: prevSample.r + (nr - prevSample.r) * alpha,
      g: prevSample.g + (ng - prevSample.g) * alpha,
      b: prevSample.b + (nb - prevSample.b) * alpha,
      luma: prevSample.luma + (nluma - prevSample.luma) * alpha,
    };
  } catch {
    return prevSample;
  }
}

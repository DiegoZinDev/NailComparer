import * as THREE from 'three';
import { createNail3DGeometry } from './nail3DGeometry';
import { generatePBRTextureMaps, type PBRTextureBundle } from './nail3DReconstructor';
import type { ImageLayoutRect } from './nailRenderer';
import type { FingerPose, NailAdjustment, NailDesign, NailShape } from '../types/nail';

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

const FINGER_IDS: FingerPose['id'][] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

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
 * Renders all 10 procedural Studio Catalog designs into a crisp 256 x 384 albedo canvas
 * so every Studio design runs through the exact same PBR + MeshPhysicalMaterial 3D pipeline.
 */
function buildProceduralStudioAlbedoCanvas(design: NailDesign): HTMLCanvasElement {
  const w = 256;
  const h = 384;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const base = design.baseColor || '#E8C5BA';
  const secondary = design.secondaryColor || '#FFFFFF';
  const accent = design.accentColor || '#D4AF37';

  const bedGrad = ctx.createLinearGradient(0, 0, 0, h);
  bedGrad.addColorStop(0, shadeHex(base, 8));
  bedGrad.addColorStop(0.62, base);
  bedGrad.addColorStop(1, shadeHex(base, -12));
  ctx.fillStyle = bedGrad;
  ctx.fillRect(0, 0, w, h);

  switch (design.patternType) {
    case 'french': {
      const isMicro = design.name.toLowerCase().includes('micro');
      const tipY = isMicro ? h * 0.2 : h * 0.31;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, tipY + h * 0.06);
      ctx.quadraticCurveTo(w * 0.5, tipY - h * 0.12, 0, tipY + h * 0.06);
      ctx.closePath();
      const tipGrad = ctx.createLinearGradient(0, 0, w, tipY);
      tipGrad.addColorStop(0, shadeHex(secondary, -8));
      tipGrad.addColorStop(0.5, secondary);
      tipGrad.addColorStop(1, shadeHex(secondary, -10));
      ctx.fillStyle = tipGrad;
      ctx.fill();

      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, tipY + h * 0.055);
      ctx.quadraticCurveTo(w * 0.5, tipY - h * 0.118, w, tipY + h * 0.055);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    case 'ombre': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, secondary);
      g.addColorStop(0.36, mixHex(secondary, base, 0.48));
      g.addColorStop(0.78, base);
      g.addColorStop(1, shadeHex(base, -10));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    case 'chrome': {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, shadeHex(base, -14));
      g.addColorStop(0.28, secondary);
      g.addColorStop(0.52, accent);
      g.addColorStop(0.76, '#FFFFFF');
      g.addColorStop(1, shadeHex(base, -16));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    case 'marble': {
      ctx.strokeStyle = secondary;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.1, h * 0.22);
      ctx.bezierCurveTo(w * 0.45, h * 0.4, w * 0.62, h * 0.62, w * 0.88, h * 0.84);
      ctx.stroke();

      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(w * 0.75, h * 0.15);
      ctx.bezierCurveTo(w * 0.52, h * 0.45, w * 0.3, h * 0.64, w * 0.2, h * 0.9);
      ctx.stroke();

      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.88;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(w * 0.34, h * 0.28);
      ctx.quadraticCurveTo(w * 0.58, h * 0.52, w * 0.7, h * 0.78);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    case 'gold-foil': {
      const flakes = [
        [0.34, 0.3, 0.26, 0.15, 0.4],
        [0.64, 0.5, 0.3, 0.14, -0.5],
        [0.42, 0.7, 0.22, 0.12, 0.2],
        [0.54, 0.18, 0.18, 0.1, -0.2],
      ];
      for (const [fx, fy, fw, fh, rot] of flakes) {
        ctx.save();
        ctx.translate(fx * w, fy * h);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.moveTo(-fw * w * 0.5, -fh * h * 0.3);
        ctx.lineTo(fw * w * 0.2, -fh * h * 0.5);
        ctx.lineTo(fw * w * 0.5, fh * h * 0.35);
        ctx.lineTo(-fw * w * 0.25, fh * h * 0.45);
        ctx.closePath();
        const fg = ctx.createLinearGradient(-fw * w, -fh * h, fw * w, fh * h);
        fg.addColorStop(0, accent);
        fg.addColorStop(0.5, secondary);
        fg.addColorStop(1, '#9E7B1E');
        ctx.fillStyle = fg;
        ctx.fill();
        ctx.restore();
      }
      break;
    }

    case 'cat-eye': {
      const beam = ctx.createRadialGradient(w * 0.46, h * 0.42, 6, w * 0.5, h * 0.5, h * 0.65);
      beam.addColorStop(0, accent);
      beam.addColorStop(0.28, secondary);
      beam.addColorStop(0.68, base);
      beam.addColorStop(1, shadeHex(base, -28));
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    case 'aurora': {
      const aura = ctx.createLinearGradient(0, 0, w, h);
      aura.addColorStop(0, base);
      aura.addColorStop(0.35, secondary);
      aura.addColorStop(0.7, accent);
      aura.addColorStop(1, '#E6D6F5');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    case 'solid':
    default:
      break;
  }

  return canvas;
}

interface FingerRig {
  nailMesh: THREE.Mesh;
  occluderMesh: THREE.Mesh;
  initialized: boolean;
  currentPos: THREE.Vector3;
  currentQuat: THREE.Quaternion;
  currentScale: THREE.Vector3;
  occluderPos: THREE.Vector3;
  occluderQuat: THREE.Quaternion;
}

/**
 * Three.js + PBR 3D Nail Scene Engine (V4):
 * - Transparent THREE.WebGLRenderer overlaid cleanly on top of live camera/model background
 * - Full 3D orthonormal basis & Quaternion SLERP tracking per finger (with palm normal cross product)
 * - Parametric 3D Solid Shell Geometry (`createNail3DGeometry`) with real C-Curve, Gel Apex, & thickness
 * - `THREE.MeshPhysicalMaterial` with `clearcoat: 1.0`, `clearcoatRoughness: 0.04`, Sobel `normalMap`,
 *   `roughnessMap`, `metalnessMap`, and organic cuticle `alphaMap`
 * - Procedural `PMREMGenerator` Softbox Studio environment map + adaptive `HemisphereLight` & key `DirectionalLight`
 * - 5 invisible 3D phalanx occluder capsules (`colorWrite: false, depthWrite: true`) for real finger depth occlusion!
 */
export class ThreeNailScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private envMap: THREE.Texture | null = null;

  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;

  private geometries = new Map<NailShape, THREE.BufferGeometry>();
  private pbrCache = new Map<string, PBRTextureBundle>();
  private pendingImageKeys = new Set<string>();

  private material: THREE.MeshPhysicalMaterial;
  private occluderMaterial: THREE.MeshBasicMaterial;
  private occluderGeometry: THREE.CapsuleGeometry;

  private fingerRigs = new Map<FingerPose['id'], FingerRig>();
  private ready = false;

  // Reusable math scratch objects (zero per-frame GC churn at 60fps)
  private tmpTip = new THREE.Vector3();
  private tmpDip = new THREE.Vector3();
  private tmpPip = new THREE.Vector3();
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
  private tmpOccDir = new THREE.Vector3();
  private tmpOccQuat = new THREE.Quaternion();
  private tmpOccUp = new THREE.Vector3(0, 1, 0);

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 5000);
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);

    this.dirLight = new THREE.DirectionalLight(0xfff6ef, 1.55);
    this.dirLight.position.set(-220, 380, 760);
    this.scene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight(0xf3e8ff, 0.65);
    this.rimLight.position.set(340, -140, 520);
    this.scene.add(this.rimLight);

    this.hemiLight = new THREE.HemisphereLight(0xfff5ee, 0x5c3e36, 1.15);
    this.scene.add(this.hemiLight);

    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 1.0, // modulated by roughnessMap
      metalness: 1.0, // modulated by metalnessMap
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      ior: 1.52,
      reflectivity: 0.9,
      envMapIntensity: 1.35,
      normalScale: new THREE.Vector2(1.0, 1.0),
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    this.occluderMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
    });
    this.occluderGeometry = new THREE.CapsuleGeometry(0.5, 1.0, 6, 12);

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      this.renderer = renderer;

      this.envMap = createStudioEnvironmentMap(renderer);
      this.scene.environment = this.envMap;

      const initialGeo = this.getOrCreateGeometry('almond');
      for (const id of FINGER_IDS) {
        const occluderMesh = new THREE.Mesh(this.occluderGeometry, this.occluderMaterial);
        occluderMesh.renderOrder = 0;
        occluderMesh.visible = false;
        this.scene.add(occluderMesh);

        const nailMesh = new THREE.Mesh(initialGeo, this.material);
        nailMesh.renderOrder = 1;
        nailMesh.visible = false;
        this.scene.add(nailMesh);

        this.fingerRigs.set(id, {
          nailMesh,
          occluderMesh,
          initialized: false,
          currentPos: new THREE.Vector3(),
          currentQuat: new THREE.Quaternion(),
          currentScale: new THREE.Vector3(1, 1, 1),
          occluderPos: new THREE.Vector3(),
          occluderQuat: new THREE.Quaternion(),
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
      geo = createNail3DGeometry(shape, 1.0);
      this.geometries.set(shape, geo);
    }
    return geo;
  }

  private getPBRBundleForDesign(design: NailDesign): PBRTextureBundle | null {
    if (design.imageDataUrl) {
      const key = `img:${design.id}:${design.finish}:${design.imageDataUrl.slice(-24)}`;
      const cached = this.pbrCache.get(key);
      if (cached) return cached;

      if (!this.pendingImageKeys.has(key)) {
        this.pendingImageKeys.add(key);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const bundle = generatePBRTextureMaps(img, {
            finish: design.finish,
            patternType: design.patternType,
            width: 320,
            height: 480,
          });
          this.pbrCache.set(key, bundle);
          this.pendingImageKeys.delete(key);
        };
        img.onerror = () => {
          this.pendingImageKeys.delete(key);
        };
        img.src = design.imageDataUrl;
      }

      // While image decodes asynchronously, return fallback studio PBR bundle if any
      const fallbackKey = `fallback:${design.baseColor}:${design.finish}`;
      let fallback = this.pbrCache.get(fallbackKey);
      if (!fallback) {
        const c = buildProceduralStudioAlbedoCanvas(design);
        fallback = generatePBRTextureMaps(c, {
          finish: design.finish,
          patternType: design.patternType,
          width: 256,
          height: 384,
        });
        this.pbrCache.set(fallbackKey, fallback);
      }
      return fallback;
    }

    const procKey = `proc:${design.id}:${design.baseColor}:${design.patternType}:${design.finish}`;
    const existing = this.pbrCache.get(procKey);
    if (existing) return existing;

    const albedoCanvas = buildProceduralStudioAlbedoCanvas(design);
    const bundle = generatePBRTextureMaps(albedoCanvas, {
      finish: design.finish,
      patternType: design.patternType,
      width: 256,
      height: 384,
    });
    this.pbrCache.set(procKey, bundle);
    return bundle;
  }

  private syncViewport(cssW: number, cssH: number, dpr: number): void {
    const renderer = this.renderer;
    if (!renderer) return;

    const targetW = Math.max(1, Math.round(cssW * dpr));
    const targetH = Math.max(1, Math.round(cssH * dpr));
    const dom = renderer.domElement;
    if (dom.width !== targetW || dom.height !== targetH) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(cssW, cssH, false);
    }

    const halfH = cssH * 0.5;
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const camDist = halfH / Math.tan(fovRad / 2);

    this.camera.aspect = Math.max(0.1, cssW / Math.max(1, cssH));
    this.camera.position.set(0, 0, camDist);
    this.camera.near = Math.max(1, camDist * 0.05);
    this.camera.far = camDist * 4.5;
    this.camera.updateProjectionMatrix();
  }

  public clear(cssW: number, cssH: number, dpr: number): void {
    if (!this.renderer) return;
    this.syncViewport(cssW, cssH, dpr);
    for (const rig of this.fingerRigs.values()) {
      rig.nailMesh.visible = false;
      rig.occluderMesh.visible = false;
      rig.initialized = false;
    }
    this.renderer.clear();
  }

  /**
   * Projects normalized MediaPipe landmark (x, y, z) into 3D scene space centered at (0,0,0),
   * where 1 world unit = 1 CSS pixel at z = 0.
   */
  private landmarkToScene(
    pt: { x: number; y: number; z?: number },
    rect: ImageLayoutRect,
    cssW: number,
    cssH: number,
    mirrorX: boolean,
    out: THREE.Vector3
  ): THREE.Vector3 {
    const nx = mirrorX ? 1 - pt.x : pt.x;
    const px = rect.drawX + nx * rect.drawW - cssW * 0.5;
    const py = cssH * 0.5 - (rect.drawY + pt.y * rect.drawH);
    const pz = -(pt.z ?? 0) * rect.drawW * 0.85;
    return out.set(px, py, pz);
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
    mirrorX = false
  ): void {
    const renderer = this.renderer;
    if (!renderer || !this.ready) return;

    this.syncViewport(cssW, cssH, dpr);
    if (poses.length === 0) {
      this.clear(cssW, cssH, dpr);
      return;
    }

    const pbr = this.getPBRBundleForDesign(design);
    if (!pbr) return;

    const geo = this.getOrCreateGeometry(adjustment.shape);

    // Update PBR Material uniforms & reactive normalScale
    if (this.material.map !== pbr.map) {
      this.material.map = pbr.map;
      this.material.normalMap = pbr.normalMap;
      this.material.roughnessMap = pbr.roughnessMap;
      this.material.metalnessMap = pbr.metalnessMap;
      this.material.alphaMap = pbr.alphaMap;
      this.material.needsUpdate = true;
    }

    const isTexturedOrCustom = Boolean(design.imageDataUrl) || design.patternType === 'gold-foil' || design.patternType === 'marble';
    const nScale = isTexturedOrCustom ? 1.4 : 0.8;
    this.material.normalScale.set(nScale, nScale);
    this.material.opacity = adjustment.opacity;
    this.material.clearcoat = design.finish === 'velvet' ? 0.35 : 1.0;
    this.material.clearcoatRoughness =
      design.finish === 'velvet' ? 0.38 : design.finish === 'chrome' ? 0.025 : 0.04;
    this.material.envMapIntensity =
      design.finish === 'chrome' ? 1.85 : design.finish === 'velvet' ? 0.85 : 1.35;

    // Adaptive Scene Lighting synced with live skin RGB & luminance
    const lumExposure = Math.max(0.7, Math.min(1.35, 0.72 + ambient.luma * 0.85));
    this.hemiLight.color.setRGB(
      Math.min(1, 0.72 + ambient.r * 0.35),
      Math.min(1, 0.70 + ambient.g * 0.35),
      Math.min(1, 0.68 + ambient.b * 0.35)
    );
    this.hemiLight.groundColor.setRGB(
      ambient.r * 0.65,
      ambient.g * 0.55,
      ambient.b * 0.50
    );
    this.hemiLight.intensity = 0.95 * lumExposure;
    this.dirLight.intensity = 1.45 * lumExposure;
    renderer.toneMappingExposure = 0.95 + ambient.luma * 0.25;

    const shapeMult = SHAPE_LENGTH_MULT[adjustment.shape] ?? 1.0;
    const seenIds = new Set<FingerPose['id']>();

    for (const pose of poses) {
      const rig = this.fingerRigs.get(pose.id);
      if (!rig) continue;
      seenIds.add(pose.id);

      if (rig.nailMesh.geometry !== geo) {
        rig.nailMesh.geometry = geo;
      }

      this.landmarkToScene(pose.tip, rect, cssW, cssH, mirrorX, this.tmpTip);
      this.landmarkToScene(pose.dip, rect, cssW, cssH, mirrorX, this.tmpDip);
      if (pose.pip) {
        this.landmarkToScene(pose.pip, rect, cssW, cssH, mirrorX, this.tmpPip);
      } else {
        this.tmpPip.copy(this.tmpDip).addScaledVector(
          this.tmpAxisY.copy(this.tmpDip).sub(this.tmpTip),
          1.25
        );
      }

      // Finger axis Y = normalize(TIP - DIP)
      this.tmpAxisY.copy(this.tmpTip).sub(this.tmpDip);
      const segLen = this.tmpAxisY.length();
      if (segLen < 4) {
        rig.nailMesh.visible = false;
        rig.occluderMesh.visible = false;
        continue;
      }
      this.tmpAxisY.normalize();

      // Palm normal aligned toward dorsal/camera side (+Z)
      if (pose.palmNormal) {
        const pnx = mirrorX ? -pose.palmNormal.x : pose.palmNormal.x;
        this.tmpPalmNormal.set(pnx, -pose.palmNormal.y, -pose.palmNormal.z);
        if (this.tmpPalmNormal.z < 0) {
          // Ensure dorsal nail normal generally faces viewer when hand dorsal/palmar flips
          this.tmpPalmNormal.negate();
        }
        if (this.tmpPalmNormal.lengthSq() < 1e-4) {
          this.tmpPalmNormal.set(0, 0, 1);
        } else {
          this.tmpPalmNormal.normalize();
        }
      } else {
        this.tmpPalmNormal.set(0, 0, 1);
      }

      // Build orthonormal 3D basis:
      // X = normalize(Y x palmNormal), Z = normalize(X x Y)
      this.tmpAxisX.crossVectors(this.tmpAxisY, this.tmpPalmNormal);
      if (this.tmpAxisX.lengthSq() < 1e-4) {
        this.tmpAxisX.set(1, 0, 0);
      } else {
        this.tmpAxisX.normalize();
      }
      this.tmpAxisZ.crossVectors(this.tmpAxisX, this.tmpAxisY).normalize();
      if (this.tmpAxisZ.z < 0) {
        this.tmpAxisX.negate();
        this.tmpAxisZ.negate();
      }

      this.tmpMatrix.makeBasis(this.tmpAxisX, this.tmpAxisY, this.tmpAxisZ);
      this.tmpTargetQuat.setFromRotationMatrix(this.tmpMatrix);

      if (Math.abs(adjustment.rotationDeg) > 0.01) {
        this.tmpRotOffsetQuat.setFromAxisAngle(
          this.tmpAxisZ,
          (-adjustment.rotationDeg * Math.PI) / 180
        );
        this.tmpTargetQuat.premultiply(this.tmpRotOffsetQuat);
      }

      // Cuticle anchor cleanly between DIP and TIP (0.44 thumb, 0.39 fingers)
      const cuticleT = pose.id === 'thumb' ? 0.44 : 0.39;
      this.tmpCuticle.copy(this.tmpDip).lerp(this.tmpTip, cuticleT);

      // Generous 1.12x anatomical width coverage + nail bed thickness lift along dorsal Z
      const nailW = pose.widthScale * rect.drawW * 1.12 * adjustment.scale;
      const baseH = Math.max(pose.lengthScale * rect.drawH, segLen * 0.92);
      const nailH = baseH * adjustment.scale * adjustment.extensionLength * shapeMult;
      const nailDepth = nailW; // preserves proportional 3D C-Curve & Gel Apex depth

      this.tmpTargetPos.copy(this.tmpCuticle).addScaledVector(this.tmpAxisZ, nailW * 0.14);
      this.tmpTargetScale.set(nailW, nailH, nailDepth);

      // Update invisible 3D phalanx occluder capsule along PIP -> TIP slightly beneath dorsal surface
      this.tmpOccDir.copy(this.tmpTip).sub(this.tmpPip);
      const phalanxLen = Math.max(segLen * 1.6, this.tmpOccDir.length());
      this.tmpOccDir.normalize();
      this.tmpOccQuat.setFromUnitVectors(this.tmpOccUp, this.tmpOccDir);

      const occCenter = rig.occluderPos;
      occCenter
        .copy(this.tmpPip)
        .lerp(this.tmpTip, 0.48)
        .addScaledVector(this.tmpAxisZ, -nailW * 0.44);

      if (!rig.initialized) {
        rig.currentPos.copy(this.tmpTargetPos);
        rig.currentQuat.copy(this.tmpTargetQuat);
        rig.currentScale.copy(this.tmpTargetScale);
        rig.occluderQuat.copy(this.tmpOccQuat);
        rig.initialized = true;
      } else {
        rig.currentPos.lerp(this.tmpTargetPos, 0.46);
        rig.currentQuat.slerp(this.tmpTargetQuat, 0.42);
        rig.currentScale.lerp(this.tmpTargetScale, 0.46);
        rig.occluderQuat.slerp(this.tmpOccQuat, 0.42);
      }

      rig.nailMesh.position.copy(rig.currentPos);
      rig.nailMesh.quaternion.copy(rig.currentQuat);
      rig.nailMesh.scale.copy(rig.currentScale);
      rig.nailMesh.visible = true;

      // Phalanx depth occluder capsule: radius ~ 0.42 * nailW, length ~ phalanxLen * 0.78
      rig.occluderMesh.position.copy(occCenter);
      rig.occluderMesh.quaternion.copy(rig.occluderQuat);
      rig.occluderMesh.scale.set(nailW * 0.84, phalanxLen * 0.64, nailW * 0.84);
      rig.occluderMesh.visible = true;
    }

    for (const [id, rig] of this.fingerRigs.entries()) {
      if (!seenIds.has(id)) {
        rig.nailMesh.visible = false;
        rig.occluderMesh.visible = false;
        rig.initialized = false;
      }
    }

    renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    for (const geo of this.geometries.values()) {
      geo.dispose();
    }
    this.geometries.clear();

    for (const bundle of this.pbrCache.values()) {
      bundle.dispose();
    }
    this.pbrCache.clear();

    this.occluderGeometry.dispose();
    this.occluderMaterial.dispose();
    this.material.dispose();
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

function shadeHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function mixHex(hexA: string, hexB: string, t: number): string {
  const a = hexA.replace('#', '');
  const b = hexB.replace('#', '');
  if (a.length !== 6 || b.length !== 6) return hexA;
  const na = parseInt(a, 16);
  const nb = parseInt(b, 16);
  const r = Math.round(((na >> 16) & 0xff) * (1 - t) + ((nb >> 16) & 0xff) * t);
  const g = Math.round(((na >> 8) & 0xff) * (1 - t) + ((nb >> 8) & 0xff) * t);
  const bl = Math.round((na & 0xff) * (1 - t) + (nb & 0xff) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

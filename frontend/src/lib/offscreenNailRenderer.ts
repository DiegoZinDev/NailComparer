import * as THREE from 'three';
import {
  type VolumetricNailGeometryOptions,
  createClearDropGeometry,
  createMetalStudGeometry,
  createPearlDomeGeometry,
  createRhinestoneGeometry,
  createVolumetricNailGeometry,
  evaluateNailSurfacePointAndNormal,
} from './nail3DGeometry';
import {
  type Accessory3DMaterialSet,
  type UndersideMaterialBundle,
  applyFinishTypeToDorsalMaterial,
  createAccessory3DMaterials,
  createDorsalNailMaterial,
  createStudioRoomEnvMap,
  createUndersideNailMaterial,
  updateUndersideMaterialTint,
} from './nailShaderMaterials';
import {
  renderBlueprintNailCanvas,
  synthesizeCleanPBRBundle,
} from './proceduralPBRSynthesizer';
import type {
  Nail3DAccessoryKind,
  Nail3DAccessorySpec,
  Nail3DFinishType,
  NailFingerDesignSpec,
  NailShape,
} from '../types/nail';

const PREVIEW_WIDTH = 384;
const PREVIEW_HEIGHT = 512;
const STUDIO_BG_HEX = 0x1d1a1f;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function resolveFinishType(spec: NailFingerDesignSpec): Nail3DFinishType {
  if (spec.manufacturingSpec?.finishType) {
    return spec.manufacturingSpec.finishType;
  }
  switch (spec.finishStyle) {
    case 'chrome_mirror':
      return 'mirror_chrome';
    case 'pearl_glazed':
      return 'glazed_pearl';
    case 'jelly_translucent':
      return 'jelly_translucent';
    case 'cat_eye':
      return 'cat_eye_magnetic';
    case 'velvet_matte':
      return 'velvet_matte';
    case 'glossy_gel':
    default:
      if (spec.pattern === 'chrome_mirror') return 'mirror_chrome';
      return 'solid_gloss_gel';
  }
}

function resolveBaseColorHex(spec: NailFingerDesignSpec): string {
  return (
    spec.manufacturingSpec?.trueBaseColorHex ||
    spec.blueprint?.baseLayer.baseColorHex ||
    spec.baseColor ||
    '#E5BEB3'
  );
}

function loadCanvasImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load comparison image'));
    img.src = src;
  });
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const iw = img.naturalWidth || dw;
  const ih = img.naturalHeight || dh;
  const targetRatio = dw / dh;
  const imgRatio = iw / ih;

  let sx = 0;
  let sy = 0;
  let sw = iw;
  let sh = ih;

  if (imgRatio > targetRatio) {
    sw = ih * targetRatio;
    sx = (iw - sw) * 0.5;
  } else {
    sh = iw / targetRatio;
    sy = (ih - sh) * 0.5;
  }

  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawDiscreetTopBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  xCenter: number,
  yTop: number
): void {
  ctx.save();
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const padX = 12;
  const textW = ctx.measureText(text).width;
  const boxW = Math.min(356, textW + padX * 2);
  const boxH = 24;
  const x = xCenter - boxW * 0.5;
  const y = yTop;

  ctx.fillStyle = 'rgba(18, 14, 20, 0.72)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, boxW, boxH, 12);
  } else {
    ctx.rect(x, y, boxW, boxH);
  }
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(250, 245, 248, 0.94)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, xCenter, y + boxH * 0.5 + 0.5, boxW - 12);
  ctx.restore();
}

/**
 * Reusable lightweight offscreen Three.js 3D nail studio renderer (`384 × 512`):
 * - Uses 1 single shared `WebGLRenderer` (`preserveDrawingBuffer: true`) + HDR `createStudioRoomEnvMap`
 * - Renders volumetric C-curved nail + real `InstancedMesh` / `Mesh` 3D accessories anchored cleanly
 *   on `evaluateNailSurfacePointAndNormal(acc.u, acc.v, shape, geoOpts)`
 * - Falls back gracefully to vector 2D studio canvas (`renderBlueprintNailCanvas`) when WebGL is unavailable
 */
export class OffscreenNailRenderSession {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private envMap: THREE.Texture | null = null;

  private dorsalMaterial: THREE.MeshPhysicalMaterial | null = null;
  private undersideBundle: UndersideMaterialBundle | null = null;
  private accessoryMaterials: Accessory3DMaterialSet | null = null;

  private metalStudGeo: THREE.BufferGeometry | null = null;
  private pearlDomeGeo: THREE.BufferGeometry | null = null;
  private rhinestoneGeo: THREE.BufferGeometry | null = null;
  private clearDropGeo: THREE.BufferGeometry | null = null;

  private nailRoot: THREE.Group | null = null;
  private accessoryGroup: THREE.Group | null = null;

  private readonly tmpSurfOut = {
    position: new THREE.Vector3(),
    normal: new THREE.Vector3(),
  };
  private readonly tmpUpZ = new THREE.Vector3(0, 0, 1);
  private readonly tmpWorldNormal = new THREE.Vector3();
  private readonly tmpAccPosVec = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScaleVec = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpMat4 = new THREE.Matrix4();

  constructor() {
    if (typeof document === 'undefined') return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = PREVIEW_WIDTH;
      canvas.height = PREVIEW_HEIGHT;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(1);
      renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
      renderer.setClearColor(STUDIO_BG_HEX, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(STUDIO_BG_HEX);

      const camera = new THREE.PerspectiveCamera(
        32,
        PREVIEW_WIDTH / PREVIEW_HEIGHT,
        0.01,
        5.0
      );
      camera.position.set(0, 0.05, 3.25);
      camera.lookAt(0, 0, 0);

      const envMap = createStudioRoomEnvMap(renderer);
      scene.environment = envMap;

      // Key light + rim light + soft studio ambient fill
      const keyLight = new THREE.DirectionalLight(0xfff7f0, 1.55);
      keyLight.position.set(-1.1, 1.6, 2.2);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0xeef2ff, 0.95);
      rimLight.position.set(1.3, 0.9, 1.2);
      scene.add(rimLight);

      const ambientLight = new THREE.HemisphereLight(0xfff8f4, 0x3b2c2a, 0.95);
      scene.add(ambientLight);

      const nailRoot = new THREE.Group();
      scene.add(nailRoot);

      const accessoryGroup = new THREE.Group();
      nailRoot.add(accessoryGroup);

      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.envMap = envMap;

      this.dorsalMaterial = createDorsalNailMaterial(envMap);
      this.undersideBundle = createUndersideNailMaterial(envMap, '#E6D5C8');
      this.accessoryMaterials = createAccessory3DMaterials(envMap);

      this.metalStudGeo = createMetalStudGeometry();
      this.pearlDomeGeo = createPearlDomeGeometry();
      this.rhinestoneGeo = createRhinestoneGeometry();
      this.clearDropGeo = createClearDropGeometry();

      this.nailRoot = nailRoot;
      this.accessoryGroup = accessoryGroup;
    } catch {
      // Headless / WebGL-disabled environment: renderNailPreview falls back cleanly to 2D studio canvas
      this.dispose();
    }
  }

  private resolveAccessoryGeometryAndMaterial(kind: Nail3DAccessoryKind): {
    geometry: THREE.BufferGeometry;
    material: THREE.MeshPhysicalMaterial;
  } | null {
    if (
      !this.accessoryMaterials ||
      !this.metalStudGeo ||
      !this.pearlDomeGeo ||
      !this.rhinestoneGeo ||
      !this.clearDropGeo
    ) {
      return null;
    }
    switch (kind) {
      case 'pearl_dome':
        return { geometry: this.pearlDomeGeo, material: this.accessoryMaterials.pearl };
      case 'rhinestone':
        return { geometry: this.rhinestoneGeo, material: this.accessoryMaterials.rhinestone };
      case '3d_drop_clear':
        return { geometry: this.clearDropGeo, material: this.accessoryMaterials.clearDrop };
      case 'metal_stud_sphere':
      case 'metal_stud_flat':
      case 'caviar_bead':
      default:
        return { geometry: this.metalStudGeo, material: this.accessoryMaterials.metalStud };
    }
  }

  private renderFallback2DStudioPreview(spec: NailFingerDesignSpec): string {
    if (typeof document === 'undefined') return '';
    const out = document.createElement('canvas');
    out.width = PREVIEW_WIDTH;
    out.height = PREVIEW_HEIGHT;
    const ctx = out.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#1D1A1F';
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    const vignette = ctx.createRadialGradient(
      PREVIEW_WIDTH * 0.5,
      PREVIEW_HEIGHT * 0.45,
      36,
      PREVIEW_WIDTH * 0.5,
      PREVIEW_HEIGHT * 0.5,
      PREVIEW_HEIGHT * 0.65
    );
    vignette.addColorStop(0, 'rgba(60, 48, 56, 0.28)');
    vignette.addColorStop(1, 'rgba(16, 13, 18, 0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    const nailW = 246;
    const nailH = 384;
    const nailCanvas = renderBlueprintNailCanvas(spec, nailW, nailH);
    ctx.drawImage(
      nailCanvas,
      (PREVIEW_WIDTH - nailW) * 0.5,
      (PREVIEW_HEIGHT - nailH) * 0.5
    );
    return out.toDataURL('image/jpeg', 0.90);
  }

  private populateAccessories3D(
    accessories: Nail3DAccessorySpec[],
    shape: NailShape,
    geoOpts: VolumetricNailGeometryOptions,
    scaleX: number,
    scaleY: number,
    scaleZ: number
  ): void {
    const group = this.accessoryGroup;
    if (!group || accessories.length === 0) return;

    // Group accessories by kind so each kind renders in a single InstancedMesh
    const grouped = new Map<Nail3DAccessoryKind, Nail3DAccessorySpec[]>();
    for (const acc of accessories) {
      const list = grouped.get(acc.kind);
      if (list) list.push(acc);
      else grouped.set(acc.kind, [acc]);
    }

    for (const [kind, items] of grouped.entries()) {
      const asset = this.resolveAccessoryGeometryAndMaterial(kind);
      if (!asset) continue;

      const instanced = new THREE.InstancedMesh(
        asset.geometry,
        asset.material,
        items.length
      );

      for (let i = 0; i < items.length; i++) {
        const acc = items[i];
        const surf = evaluateNailSurfacePointAndNormal(
          acc.u,
          acc.v,
          shape,
          geoOpts,
          this.tmpSurfOut
        );

        // Scale position from normalized nail local space [x∈[-0.5,0.5], y∈[0,1], z]
        // into world-scaled nail space
        const px = surf.position.x * scaleX;
        const py = surf.position.y * scaleY;
        const pz = surf.position.z * scaleZ;

        // Transform surface normal by non-uniform nail scale: n_world = normalize((nx/sx, ny/sy, nz/sz))
        this.tmpWorldNormal
          .set(
            surf.normal.x / Math.max(1e-6, scaleX),
            surf.normal.y / Math.max(1e-6, scaleY),
            surf.normal.z / Math.max(1e-6, scaleZ)
          )
          .normalize();

        this.tmpQuat.setFromUnitVectors(this.tmpUpZ, this.tmpWorldNormal);

        // Match threeNailScene.ts exact accessory sizing & seating math
        const rUnits = clamp(acc.radiusNorm * scaleX * 0.5, 0.012, scaleX * 0.24);
        const heightFactor = kind === 'metal_stud_flat' ? 0.55 : acc.heightRatio * 1.4;
        const hUnits = rUnits * heightFactor;

        this.tmpScaleVec.set(rUnits, rUnits, hUnits);

        // Seat slightly embedded (0.22 * hUnits) along surface normal so zero gaps/floating occur
        const seatOffset = hUnits * 0.22;
        const posX = px + this.tmpWorldNormal.x * seatOffset;
        const posY = py + this.tmpWorldNormal.y * seatOffset;
        const posZ = pz + this.tmpWorldNormal.z * seatOffset;

        this.tmpMat4.compose(
          this.tmpAccPosVec.set(posX, posY, posZ),
          this.tmpQuat,
          this.tmpScaleVec
        );
        instanced.setMatrixAt(i, this.tmpMat4);

        const defaultHex =
          kind === 'pearl_dome'
            ? '#F9F4EE'
            : kind === 'rhinestone' || kind === '3d_drop_clear'
              ? '#F3F8FF'
              : '#D9B668';
        this.tmpColor.set(acc.colorHex || defaultHex);
        instanced.setColorAt(i, this.tmpColor);
      }

      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      group.add(instanced);
    }
  }

  /**
   * Renders a real 3D studio snapshot (`384 × 512` JPEG DataURL) for any `NailFingerDesignSpec`
   * using the exact V11 parametric C-curve mesh, HDR studio envMap, and real 3D `InstancedMesh` accessories.
   */
  public renderNailPreview(spec: NailFingerDesignSpec): string {
    if (
      !this.renderer ||
      !this.scene ||
      !this.camera ||
      !this.dorsalMaterial ||
      !this.undersideBundle ||
      !this.nailRoot ||
      !this.accessoryGroup
    ) {
      return this.renderFallback2DStudioPreview(spec);
    }

    const m = spec.manufacturingSpec;
    const shape: NailShape = m?.shape ?? spec.blueprint?.geometry.shape ?? spec.shape ?? 'almond';
    const freeEdgeRatio = clamp(
      m?.freeEdgeRatio ??
        spec.blueprint?.geometry.freeEdgeRatio ??
        spec.freeEdgeRatio ??
        Math.max(0.15, (spec.lengthMultiplier ?? spec.relativeLength ?? 1.42) - 1.0),
      0.12,
      1.15
    );
    const bedFraction = clamp(1 / (1 + freeEdgeRatio), 0.44, 0.90);
    const tipRoundness = clamp(
      m?.tipRoundness ?? spec.blueprint?.geometry.tipRoundness ?? spec.tipRoundness ?? 0.5,
      0,
      1
    );
    const cCurveDepth = clamp(m?.cCurveDepth ?? 0.22, 0.16, 0.28);
    const apexHeight = clamp(m?.apexHeight ?? 0.085, 0.06, 0.11);

    const geoOpts: VolumetricNailGeometryOptions = {
      tipRoundness,
      bedFraction,
      cCurveDepth,
      apexHeight,
    };

    const bundle = synthesizeCleanPBRBundle(spec);
    const dorsalMat = this.dorsalMaterial;
    dorsalMat.map = bundle.map;
    dorsalMat.normalMap = bundle.normalMap;
    dorsalMat.roughnessMap = bundle.roughnessMap;
    dorsalMat.metalnessMap = bundle.metalnessMap;
    dorsalMat.alphaMap = bundle.alphaMap;

    const finishType = resolveFinishType(spec);
    applyFinishTypeToDorsalMaterial(dorsalMat, finishType, {
      metalness: m?.metalness,
      roughness: m?.roughness,
      clearcoat: m?.clearcoat,
    });

    const hasRelief =
      Boolean(m?.borderIs3DRaised) ||
      Boolean(m?.strokes3D?.some((st) => st.reliefHeight > 0.05)) ||
      Boolean(m?.motifs?.some((mt) => mt.is3DRaised)) ||
      Boolean(spec.has3DRelief) ||
      Boolean(spec.hasMetallicOutline);
    const nScale =
      finishType === 'mirror_chrome'
        ? hasRelief
          ? 1.1
          : 0.35
        : hasRelief
          ? 1.38
          : 1.0;
    dorsalMat.normalScale.set(nScale, nScale);

    // Underside translucency tint
    updateUndersideMaterialTint(this.undersideBundle, resolveBaseColorHex(spec));

    const nailGeo = createVolumetricNailGeometry(shape, geoOpts);
    const nailMesh = new THREE.Mesh(nailGeo, [
      dorsalMat,
      this.undersideBundle.material,
    ]);

    const scaleX = 1.0;
    const scaleY = (1.0 / bedFraction) * 1.15;
    const scaleZ = 1.0;
    nailMesh.scale.set(scaleX, scaleY, scaleZ);

    // Clear any leftover children from previous render
    while (this.accessoryGroup.children.length > 0) {
      const child = this.accessoryGroup.children[0];
      this.accessoryGroup.remove(child);
      if (child instanceof THREE.InstancedMesh) {
        child.dispose();
      }
    }

    // Center nail vertically around Y = 0 and apply studio pitch tilt (-0.10 rad)
    this.nailRoot.position.set(0, -scaleY * 0.49, 0);
    this.nailRoot.rotation.set(-0.10, 0, 0);
    this.nailRoot.add(nailMesh);

    const accessories = m?.accessories3D ?? [];
    if (accessories.length > 0) {
      this.populateAccessories3D(accessories, shape, geoOpts, scaleX, scaleY, scaleZ);
    }

    // Pull camera slightly back on extra-long extensions so the entire nail fits comfortably in 384×512
    const camZ = Math.max(3.15, 2.35 + scaleY * 0.55);
    this.camera.position.set(0, 0.02, camZ);
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/jpeg', 0.90);

    // Dispose temporary per-frame nail mesh & InstancedMesh wrappers (shared assets remain cached)
    this.nailRoot.remove(nailMesh);
    nailGeo.dispose();
    while (this.accessoryGroup.children.length > 0) {
      const child = this.accessoryGroup.children[0];
      this.accessoryGroup.remove(child);
      if (child instanceof THREE.InstancedMesh) {
        child.dispose();
      }
    }

    return dataUrl;
  }

  /**
   * Composes a crisp `768 × 512` side-by-side comparison JPEG (`[Reference Zoom | Generated 3D Model]`)
   * ready for closed-loop visual fidelity inspection (`action: 'verify_and_refine'`).
   */
  public async composeSideBySideComparison(
    referenceZoomDataUrl: string,
    rendered3DDataUrl: string,
    fingerLabel: string
  ): Promise<string> {
    const outW = 768;
    const outH = 512;
    const halfW = 384;

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return rendered3DDataUrl;

    ctx.fillStyle = '#1D1A1F';
    ctx.fillRect(0, 0, outW, outH);

    const [refResult, modelResult] = await Promise.allSettled([
      loadCanvasImage(referenceZoomDataUrl),
      loadCanvasImage(rendered3DDataUrl),
    ]);

    if (refResult.status === 'fulfilled') {
      drawCoverImage(ctx, refResult.value, 0, 0, halfW, outH);
    }
    if (modelResult.status === 'fulfilled') {
      drawCoverImage(ctx, modelResult.value, halfW, 0, halfW, outH);
    }

    // Subtle center divider line
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.fillRect(halfW - 1, 0, 2, outH);

    const safeLabel = (fingerLabel || 'Unha').toUpperCase();
    drawDiscreetTopBadge(ctx, `REFERÊNCIA REAL — ${safeLabel}`, halfW * 0.5, 12);
    drawDiscreetTopBadge(ctx, 'MODELO 3D GERADO', halfW + halfW * 0.5, 12);

    return canvas.toDataURL('image/jpeg', 0.90);
  }

  public dispose(): void {
    if (this.accessoryGroup) {
      while (this.accessoryGroup.children.length > 0) {
        const child = this.accessoryGroup.children[0];
        this.accessoryGroup.remove(child);
        if (child instanceof THREE.InstancedMesh) {
          child.dispose();
        }
      }
      this.accessoryGroup = null;
    }

    this.dorsalMaterial?.dispose();
    this.dorsalMaterial = null;

    this.undersideBundle?.dispose();
    this.undersideBundle = null;

    this.accessoryMaterials?.dispose();
    this.accessoryMaterials = null;

    this.metalStudGeo?.dispose();
    this.metalStudGeo = null;
    this.pearlDomeGeo?.dispose();
    this.pearlDomeGeo = null;
    this.rhinestoneGeo?.dispose();
    this.rhinestoneGeo = null;
    this.clearDropGeo?.dispose();
    this.clearDropGeo = null;

    this.envMap?.dispose();
    this.envMap = null;

    if (this.renderer) {
      this.renderer.forceContextLoss();
      this.renderer.dispose();
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.nailRoot = null;
  }
}

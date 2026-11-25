import * as THREE from 'three';
import {
  FINGER_LANDMARK_INDICES,
  HAND_LANDMARK_COUNT,
  HandSkeletonFilter,
  WRIST,
  computeFingerAnatomicalBasis,
  computeFingerMetricDimensions,
  projectHandToPerspectiveMeters,
} from './handKinematics';
import {
  type NailProfileStations,
  createCuticleContactSkirtGeometry,
  createVolumetricNailGeometry,
  evalNailHalfWidth,
} from './nail3DGeometry';
import type { ImageLayoutRect } from './nailRenderer';
import {
  type CuticleSkirtMaterialBundle,
  type DirectionalAmbientLightSample,
  type UndersideMaterialBundle,
  applyDorsalMaterialOpacity,
  createCuticleContactSkirtMaterial,
  createDorsalNailMaterial,
  createStudioRoomEnvMap,
  createUndersideNailMaterial,
  updateUndersideMaterialTint,
} from './nailShaderMaterials';
import {
  ORDERED_FINGERS,
  buildFingerSpecsFromStudioDesign,
  type NailFingerDesignSpec,
} from './perFingerVisionAnalyzer';
import {
  type ProceduralPBRBundle,
  hashFingerSpec,
  synthesizeProceduralPBRBundle,
} from './proceduralPBRSynthesizer';
import type {
  FingerId,
  HandSkeletonFrame,
  LiveFingerCalibration,
  NailAdjustment,
  NailDesign,
  NailShape,
} from '../types/nail';

const PERSPECTIVE_FOV_DEG = 58;
const PERSPECTIVE_NEAR = 0.01;
const PERSPECTIVE_FAR = 10.0;

/**
 * Instanced volumetric hand occluder counts:
 * - 15 phalanx cylinders = 3 segments (proximal, middle, distal) × 5 fingers
 * - 20 joint/pulp spheres = 4 spheres (MCP, PIP, DIP, distal pulp) × 5 fingers
 */
const PHALANX_INSTANCE_COUNT = ORDERED_FINGERS.length * 3; // 15
const JOINT_INSTANCE_COUNT = ORDERED_FINGERS.length * 4; // 20

/**
 * 7-point perimeter polygon for the volumetric closed palm/metacarpal occluder:
 * WRIST(0) -> THUMB_CMC(1) -> THUMB_MCP(2) -> INDEX_MCP(5) -> MIDDLE_MCP(9) -> RING_MCP(13) -> PINKY_MCP(17)
 */
const PALM_POLYGON_INDICES = [0, 1, 2, 5, 9, 13, 17] as const;
const PALM_VERTS_PER_FACE = PALM_POLYGON_INDICES.length; // 7
const PALM_CENTER_DORSAL_IDX = PALM_VERTS_PER_FACE * 2; // 14
const PALM_CENTER_PALMAR_IDX = PALM_VERTS_PER_FACE * 2 + 1; // 15
const PALM_TOTAL_VERTICES = PALM_VERTS_PER_FACE * 2 + 2; // 16

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function quantizeStep(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function isMobileViewport(cssW: number): boolean {
  if (cssW <= 820) return true;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse)').matches;
  }
  return false;
}

interface FingerRig {
  fingerId: FingerId;
  fingerIndex: number;
  nailMesh: THREE.Mesh;
  dorsalMaterial: THREE.MeshPhysicalMaterial;
  undersideBundle: UndersideMaterialBundle;
  cuticleSkirtMesh: THREE.Mesh;
  currentSpecHash: string;
}

/**
 * Three.js V10 Photorealistic Volumetric AR 3D Nail Scene Engine (60fps Mobile Radical Fast-Path):
 * - `preserveDrawingBuffer: false` + mobile DPR cap `<= 1.25` (desktop `<= 1.5`) + `renderNow()` on capture
 * - Entire volumetric hand occluder collapsed from 36 meshes into **3 draw calls**:
 *   1× `InstancedMesh` (15 phalanges) + 1× `InstancedMesh` (20 joints/pulps) + 1× closed `palmOccluderMesh`
 *   (Total <= 13 draw calls/frame across the entire hand: 3 occluders + 5 nails + 5 skirts)
 * - ZERO `bumpMap` / `displacementMap` / `displacementScale`, opaque dorsal fast-path when `opacity >= 0.99`
 * - Client-native anatomical fit: `nailWidthMeters` driven strictly by `computeFingerMetricDimensions`
 *   (never overridden by reference `relativeWidth`), dynamic `bedFraction = 1 / (1 + effectiveFreeEdge)`,
 *   and PCHIP `profileHalfWidths[8]` silhouettes anchored tightly on `lerp(DIP, TIP, 0.20)`
 */
export class ThreeNailScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private envMap: THREE.Texture | null = null;

  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;

  private readonly skeletonFilter = new HandSkeletonFilter();
  private readonly projectedPoints: THREE.Vector3[] = Array.from(
    { length: HAND_LANDMARK_COUNT },
    () => new THREE.Vector3()
  );

  // Cached geometries outside RAF (keyed by shape + tipRoundness + quantized bedFraction + profileHalfWidths)
  private nailGeometries = new Map<string, THREE.BufferGeometry>();
  private skirtGeometries = new Map<string, THREE.BufferGeometry>();

  // Shared conformal cuticle skirt material & instanced volumetric occluders
  private skirtMaterialBundle: CuticleSkirtMaterialBundle;
  private occluderMaterial: THREE.MeshBasicMaterial;
  private occluderCylinderGeo: THREE.CylinderGeometry;
  private occluderSphereGeo: THREE.SphereGeometry;
  private phalanxInstancedMesh: THREE.InstancedMesh;
  private jointInstancedMesh: THREE.InstancedMesh;

  // Pre-allocated closed extruded palm occluder mesh (zero per-frame BufferGeometry allocation)
  private palmOccluderGeo: THREE.BufferGeometry;
  private palmPositions: Float32Array;
  private palmPositionAttr: THREE.BufferAttribute;
  private palmOccluderMesh: THREE.Mesh;

  private fingerRigs = new Map<FingerId, FingerRig>();
  private ready = false;

  // Design & PBR bundle cache — zero texture synthesis inside RAF
  private lastDesignRef: NailDesign | null = null;
  private activeDesignKey = '';
  private cachedFingerSpecs: Record<FingerId, NailFingerDesignSpec> | null = null;
  private cachedPBRBundles = new Map<FingerId, ProceduralPBRBundle>();

  // Reusable math scratch objects (zero per-frame GC churn)
  private tmpBasisMatrix = new THREE.Matrix4();
  private tmpInstanceMatrix = new THREE.Matrix4();
  private tmpZeroScaleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private tmpInstancePos = new THREE.Vector3();
  private tmpInstanceQuat = new THREE.Quaternion();
  private tmpInstanceScale = new THREE.Vector3();
  private tmpRotOffsetQuat = new THREE.Quaternion();
  private tmpAxisX = new THREE.Vector3();
  private tmpAxisY = new THREE.Vector3();
  private tmpAxisZ = new THREE.Vector3();
  private tmpCuticlePos = new THREE.Vector3();
  private tmpNailPos = new THREE.Vector3();
  private tmpNailQuat = new THREE.Quaternion();
  private tmpRodDir = new THREE.Vector3();
  private tmpRodCenter = new THREE.Vector3();
  private tmpRodQuat = new THREE.Quaternion();
  private tmpUpY = new THREE.Vector3(0, 1, 0);
  private tmpPulpPos = new THREE.Vector3();
  private tmpPalmEdgeA = new THREE.Vector3();
  private tmpPalmEdgeB = new THREE.Vector3();
  private tmpPalmNormal = new THREE.Vector3();
  private tmpPalmCenter = new THREE.Vector3();
  private tmpPalmCross = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();

    const initW = canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 390);
    const initH = canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 844);
    const initAspect = initW > 0 && initH > 0 ? initW / initH : 9 / 16;

    this.camera = new THREE.PerspectiveCamera(
      PERSPECTIVE_FOV_DEG,
      initAspect,
      PERSPECTIVE_NEAR,
      PERSPECTIVE_FAR
    );
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);

    this.dirLight = new THREE.DirectionalLight(0xfff6ef, 1.55);
    this.dirLight.position.set(-0.35, 0.75, 0.9);
    this.scene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight(0xf3e8ff, 0.6);
    this.rimLight.position.set(0.7, -0.25, 0.65);
    this.scene.add(this.rimLight);

    this.hemiLight = new THREE.HemisphereLight(0xfff5ee, 0x5c3e36, 1.15);
    this.scene.add(this.hemiLight);

    this.skirtMaterialBundle = createCuticleContactSkirtMaterial();

    this.occluderMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });

    // Shared unit primitives: Cylinder(radius=1, height=1), Sphere(radius=1)
    this.occluderCylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    this.occluderSphereGeo = new THREE.SphereGeometry(1, 12, 10);

    // Instanced volumetric phalanx cylinders (15 instances = 1 draw call)
    this.phalanxInstancedMesh = new THREE.InstancedMesh(
      this.occluderCylinderGeo,
      this.occluderMaterial,
      PHALANX_INSTANCE_COUNT
    );
    this.phalanxInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.phalanxInstancedMesh.renderOrder = 1;
    this.phalanxInstancedMesh.frustumCulled = false;
    this.phalanxInstancedMesh.visible = false;
    this.scene.add(this.phalanxInstancedMesh);

    // Instanced volumetric joint + distal pulp spheres (20 instances = 1 draw call)
    this.jointInstancedMesh = new THREE.InstancedMesh(
      this.occluderSphereGeo,
      this.occluderMaterial,
      JOINT_INSTANCE_COUNT
    );
    this.jointInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.jointInstancedMesh.renderOrder = 1;
    this.jointInstancedMesh.frustumCulled = false;
    this.jointInstancedMesh.visible = false;
    this.scene.add(this.jointInstancedMesh);

    // Pre-allocated closed extruded 7-gon palm occluder (16 vertices = 1 draw call)
    this.palmPositions = new Float32Array(PALM_TOTAL_VERTICES * 3);
    this.palmPositionAttr = new THREE.BufferAttribute(this.palmPositions, 3);
    this.palmPositionAttr.setUsage(THREE.DynamicDrawUsage);

    const palmIndices: number[] = [];
    const n = PALM_VERTS_PER_FACE;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      palmIndices.push(PALM_CENTER_DORSAL_IDX, i, next);
    }
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      palmIndices.push(PALM_CENTER_PALMAR_IDX, n + next, n + i);
    }
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const d0 = i;
      const d1 = next;
      const p0 = n + i;
      const p1 = n + next;
      palmIndices.push(d0, p0, p1);
      palmIndices.push(d0, p1, d1);
    }

    this.palmOccluderGeo = new THREE.BufferGeometry();
    this.palmOccluderGeo.setAttribute('position', this.palmPositionAttr);
    this.palmOccluderGeo.setIndex(palmIndices);

    this.palmOccluderMesh = new THREE.Mesh(this.palmOccluderGeo, this.occluderMaterial);
    this.palmOccluderMesh.renderOrder = 1;
    this.palmOccluderMesh.frustumCulled = false;
    this.palmOccluderMesh.visible = false;
    this.scene.add(this.palmOccluderMesh);

    this.resetOccluderInstances();

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
      const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const initDpr = Math.min(rawDpr, isMobileViewport(initW) ? 1.25 : 1.5);
      renderer.setPixelRatio(initDpr);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.06;
      this.renderer = renderer;

      this.envMap = createStudioRoomEnvMap(renderer);
      this.scene.environment = this.envMap;

      const defaultBedFraction = 0.68;
      const defaultNailGeo = this.getOrCreateNailGeometry('almond', defaultBedFraction, 0.5);
      const defaultSkirtGeo = this.getOrCreateSkirtGeometry('almond', defaultBedFraction);

      ORDERED_FINGERS.forEach((id, fingerIndex) => {
        const dorsalMaterial = createDorsalNailMaterial(this.envMap);
        const undersideBundle = createUndersideNailMaterial(this.envMap, '#E6D5C8');

        const cuticleSkirtMesh = new THREE.Mesh(
          defaultSkirtGeo,
          this.skirtMaterialBundle.material
        );
        cuticleSkirtMesh.renderOrder = 2;
        cuticleSkirtMesh.frustumCulled = false;
        cuticleSkirtMesh.visible = false;
        this.scene.add(cuticleSkirtMesh);

        const nailMesh = new THREE.Mesh(defaultNailGeo, [
          dorsalMaterial,
          undersideBundle.material,
        ]);
        nailMesh.renderOrder = 2;
        nailMesh.frustumCulled = false;
        nailMesh.visible = false;
        this.scene.add(nailMesh);

        this.fingerRigs.set(id, {
          fingerId: id,
          fingerIndex,
          nailMesh,
          dorsalMaterial,
          undersideBundle,
          cuticleSkirtMesh,
          currentSpecHash: '',
        });
      });

      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  public isReady(): boolean {
    return this.ready && this.renderer !== null;
  }

  /**
   * Renders the current WebGL scene synchronously so snapshot captures in `ARCameraCanvas.tsx`
   * read a fresh drawing buffer even with `preserveDrawingBuffer: false`.
   */
  public renderNow(): void {
    if (!this.renderer || !this.ready) return;
    this.renderer.render(this.scene, this.camera);
  }

  public resetTracking(): void {
    this.skeletonFilter.reset();
    this.hideAll();
  }

  private getOrCreateNailGeometry(
    shape: NailShape,
    bedFraction: number,
    tipRoundness?: number,
    profileHalfWidths?: NailProfileStations
  ): THREE.BufferGeometry {
    const quantizedBed = clamp(quantizeStep(bedFraction, 0.02), 0.44, 0.90);
    const roundedQ =
      tipRoundness !== undefined ? clamp(quantizeStep(tipRoundness, 0.05), 0, 1) : 0.5;
    const profileKey =
      profileHalfWidths && profileHalfWidths.length === 8
        ? profileHalfWidths.map((v) => v.toFixed(2)).join(',')
        : 'std';
    const key = `${shape}:${quantizedBed.toFixed(2)}:${roundedQ.toFixed(2)}:${profileKey}`;

    let geo = this.nailGeometries.get(key);
    if (!geo) {
      geo = createVolumetricNailGeometry(shape, {
        tipRoundness: roundedQ,
        bedFraction: quantizedBed,
        profileHalfWidths,
      });
      this.nailGeometries.set(key, geo);
    }
    return geo;
  }

  private getOrCreateSkirtGeometry(
    shape: NailShape,
    bedFraction: number
  ): THREE.BufferGeometry {
    const quantizedBed = clamp(quantizeStep(bedFraction, 0.02), 0.44, 0.90);
    const key = `${shape}:${quantizedBed.toFixed(2)}`;
    let geo = this.skirtGeometries.get(key);
    if (!geo) {
      geo = createCuticleContactSkirtGeometry(shape, quantizedBed);
      this.skirtGeometries.set(key, geo);
    }
    return geo;
  }

  private syncViewport(cssW: number, cssH: number, dpr: number): void {
    const renderer = this.renderer;
    if (!renderer) return;

    const isMobile = isMobileViewport(cssW);
    const clampedDpr = Math.min(dpr, isMobile ? 1.25 : 1.5);
    const safeW = Math.max(1, cssW);
    const safeH = Math.max(1, cssH);
    const targetW = Math.max(1, Math.round(safeW * clampedDpr));
    const targetH = Math.max(1, Math.round(safeH * clampedDpr));
    const dom = renderer.domElement;

    if (dom.width !== targetW || dom.height !== targetH) {
      renderer.setPixelRatio(clampedDpr);
      renderer.setSize(safeW, safeH, false);
    }

    const aspect = safeW / safeH;
    if (Math.abs(this.camera.aspect - aspect) > 1e-4) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  private resetOccluderInstances(): void {
    for (let i = 0; i < PHALANX_INSTANCE_COUNT; i++) {
      this.phalanxInstancedMesh.setMatrixAt(i, this.tmpZeroScaleMatrix);
    }
    for (let i = 0; i < JOINT_INSTANCE_COUNT; i++) {
      this.jointInstancedMesh.setMatrixAt(i, this.tmpZeroScaleMatrix);
    }
    this.phalanxInstancedMesh.instanceMatrix.needsUpdate = true;
    this.jointInstancedMesh.instanceMatrix.needsUpdate = true;
  }

  private hideRig(rig: FingerRig): void {
    rig.nailMesh.visible = false;
    rig.cuticleSkirtMesh.visible = false;

    const pBase = rig.fingerIndex * 3;
    this.phalanxInstancedMesh.setMatrixAt(pBase, this.tmpZeroScaleMatrix);
    this.phalanxInstancedMesh.setMatrixAt(pBase + 1, this.tmpZeroScaleMatrix);
    this.phalanxInstancedMesh.setMatrixAt(pBase + 2, this.tmpZeroScaleMatrix);

    const jBase = rig.fingerIndex * 4;
    this.jointInstancedMesh.setMatrixAt(jBase, this.tmpZeroScaleMatrix);
    this.jointInstancedMesh.setMatrixAt(jBase + 1, this.tmpZeroScaleMatrix);
    this.jointInstancedMesh.setMatrixAt(jBase + 2, this.tmpZeroScaleMatrix);
    this.jointInstancedMesh.setMatrixAt(jBase + 3, this.tmpZeroScaleMatrix);
  }

  private hideAll(): void {
    this.palmOccluderMesh.visible = false;
    this.phalanxInstancedMesh.visible = false;
    this.jointInstancedMesh.visible = false;
    for (const rig of this.fingerRigs.values()) {
      rig.nailMesh.visible = false;
      rig.cuticleSkirtMesh.visible = false;
    }
    this.resetOccluderInstances();
  }

  public clear(cssW: number, cssH: number, dpr: number): void {
    if (!this.renderer) return;
    this.syncViewport(cssW, cssH, dpr);
    this.hideAll();
    this.renderer.clear();
  }

  private computeDesignKey(design: NailDesign): string {
    let fingerSpecsPart = '';
    if (design.fingerSpecs) {
      const specs = design.fingerSpecs;
      fingerSpecsPart = ORDERED_FINGERS.map((id) => {
        const s = specs[id];
        if (!s) return '';
        return `${id}:${s.shape}:${(s.freeEdgeRatio ?? 0).toFixed(2)}:${(s.lengthMultiplier ?? s.relativeLength).toFixed(2)}:${s.hasMetallicOutline ? s.outlineColor ?? '1' : '0'}:${hashFingerSpec(s)}`;
      }).join('~');
    }
    return `${design.id}|${design.name}|${design.baseColor}|${design.secondaryColor ?? ''}|${design.accentColor ?? ''}|${design.finish}|${design.patternType}|${design.imageDataUrl ? design.imageDataUrl.length : 0}|${fingerSpecsPart}`;
  }

  private paintMetallicOutlineOnBundle(
    bundle: ProceduralPBRBundle,
    shape: NailShape,
    outlineColor: string,
    bedFraction: number,
    profileHalfWidths?: NailProfileStations
  ): void {
    const traceSilhouette = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const steps = 40;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const v = 0.05 + (i / steps) * 0.935;
        const hw =
          evalNailHalfWidth(v, shape, { bedFraction, profileHalfWidths }) * 0.91;
        const u = 0.5 - hw * 0.96;
        const x = u * w;
        const y = (1 - v) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const v = 0.05 + (i / steps) * 0.935;
        const hw =
          evalNailHalfWidth(v, shape, { bedFraction, profileHalfWidths }) * 0.91;
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
    if (design === this.lastDesignRef && this.cachedFingerSpecs) {
      return;
    }
    const key = this.computeDesignKey(design);
    if (key === this.activeDesignKey && this.cachedFingerSpecs) {
      this.lastDesignRef = design;
      return;
    }

    this.lastDesignRef = design;
    this.activeDesignKey = key;
    const specs = buildFingerSpecsFromStudioDesign(design);
    this.cachedFingerSpecs = specs;
    this.cachedPBRBundles.clear();

    for (const id of ORDERED_FINGERS) {
      const spec = specs[id];
      const bundle = synthesizeProceduralPBRBundle(spec);

      if (spec.hasMetallicOutline && spec.outlineColor && !spec.blueprint) {
        const freeEdge = clamp(
          spec.freeEdgeRatio ?? Math.max(0.15, (spec.lengthMultiplier ?? spec.relativeLength ?? 1.35) - 1.0),
          0.12,
          1.15
        );
        const defaultBed = clamp(1 / (1 + freeEdge), 0.44, 0.90);
        this.paintMetallicOutlineOnBundle(
          bundle,
          spec.shape,
          spec.outlineColor,
          defaultBed
        );
      }

      this.cachedPBRBundles.set(id, bundle);

      const rig = this.fingerRigs.get(id);
      if (!rig) continue;

      if (rig.currentSpecHash !== bundle.specHash) {
        rig.dorsalMaterial.map = bundle.map;
        rig.dorsalMaterial.normalMap = bundle.normalMap;
        rig.dorsalMaterial.roughnessMap = bundle.roughnessMap;
        rig.dorsalMaterial.metalnessMap = bundle.metalnessMap;
        rig.dorsalMaterial.alphaMap = bundle.alphaMap;

        const isRelief =
          Boolean(spec.has3DRelief) ||
          spec.pattern === 'gold_3d_waves' ||
          spec.pattern === 'floral_accent' ||
          Boolean(spec.hasMetallicOutline);
        const isChrome =
          spec.pattern === 'chrome_mirror' || spec.finishStyle === 'chrome_mirror';
        const isVelvet =
          spec.finishStyle === 'velvet_matte' ||
          (!spec.finishStyle && spec.glossIntensity < 0.65);

        const nScale = isRelief ? 1.45 : isChrome ? 0.85 : 1.05;
        rig.dorsalMaterial.normalScale.set(nScale, nScale);
        rig.dorsalMaterial.clearcoat = isVelvet ? 0.42 : 1.0;
        rig.dorsalMaterial.clearcoatRoughness = isVelvet
          ? 0.34
          : isChrome
            ? 0.025
            : 0.035;
        rig.dorsalMaterial.envMapIntensity = isChrome
          ? 1.9
          : isVelvet
            ? 0.9
            : 1.45;
        rig.dorsalMaterial.needsUpdate = true;
        rig.currentSpecHash = bundle.specHash;
      }

      updateUndersideMaterialTint(rig.undersideBundle, spec.baseColor || '#E6D5C8');
    }
  }

  private setPhalanxInstance(
    instanceIdx: number,
    start: THREE.Vector3,
    end: THREE.Vector3,
    radiusMeters: number
  ): void {
    this.tmpRodDir.subVectors(end, start);
    const len = this.tmpRodDir.length();
    if (len < 1e-4) {
      this.phalanxInstancedMesh.setMatrixAt(instanceIdx, this.tmpZeroScaleMatrix);
      return;
    }

    this.tmpRodDir.divideScalar(len);
    this.tmpRodQuat.setFromUnitVectors(this.tmpUpY, this.tmpRodDir);
    this.tmpRodCenter.copy(start).addScaledVector(this.tmpRodDir, len * 0.5);
    this.tmpInstanceScale.set(radiusMeters, len, radiusMeters);
    this.tmpInstanceMatrix.compose(
      this.tmpRodCenter,
      this.tmpRodQuat,
      this.tmpInstanceScale
    );
    this.phalanxInstancedMesh.setMatrixAt(instanceIdx, this.tmpInstanceMatrix);
  }

  private setJointInstance(
    instanceIdx: number,
    center: THREE.Vector3,
    radiusMeters: number
  ): void {
    this.tmpInstancePos.copy(center);
    this.tmpInstanceQuat.identity();
    this.tmpInstanceScale.setScalar(radiusMeters);
    this.tmpInstanceMatrix.compose(
      this.tmpInstancePos,
      this.tmpInstanceQuat,
      this.tmpInstanceScale
    );
    this.jointInstancedMesh.setMatrixAt(instanceIdx, this.tmpInstanceMatrix);
  }

  /**
   * Updates the pre-allocated closed extruded 7-gon palm occluder directly in `this.palmPositions`
   * (zero per-frame heap allocation and zero `computeBoundingSphere()`) using `this.projectedPoints`.
   */
  private updatePalmOccluder(
    points3D: readonly THREE.Vector3[],
    palmThicknessMeters: number
  ): void {
    const wrist = points3D[WRIST];
    const indexMcp = points3D[5];
    const pinkyMcp = points3D[17];

    if (!wrist || !indexMcp || !pinkyMcp) {
      this.palmOccluderMesh.visible = false;
      return;
    }

    this.tmpPalmCenter.set(0, 0, 0);
    for (let i = 0; i < PALM_VERTS_PER_FACE; i++) {
      const pt = points3D[PALM_POLYGON_INDICES[i]];
      if (!pt) {
        this.palmOccluderMesh.visible = false;
        return;
      }
      this.tmpPalmCenter.add(pt);
    }
    this.tmpPalmCenter.divideScalar(PALM_VERTS_PER_FACE);

    this.tmpPalmEdgeA.subVectors(indexMcp, wrist);
    this.tmpPalmEdgeB.subVectors(pinkyMcp, wrist);
    this.tmpPalmNormal.crossVectors(this.tmpPalmEdgeA, this.tmpPalmEdgeB);
    if (this.tmpPalmNormal.lengthSq() < 1e-8) {
      this.palmOccluderMesh.visible = false;
      return;
    }
    this.tmpPalmNormal.normalize();

    const v0 = points3D[PALM_POLYGON_INDICES[0]];
    const v1 = points3D[PALM_POLYGON_INDICES[1]];
    this.tmpPalmEdgeA.subVectors(v0, this.tmpPalmCenter);
    this.tmpPalmEdgeB.subVectors(v1, this.tmpPalmCenter);
    this.tmpPalmCross.crossVectors(this.tmpPalmEdgeA, this.tmpPalmEdgeB);
    if (this.tmpPalmCross.dot(this.tmpPalmNormal) < 0) {
      this.tmpPalmNormal.negate();
    }

    const halfThick = clamp(palmThicknessMeters * 0.5, 0.007, 0.018);
    const n = PALM_VERTS_PER_FACE;

    for (let i = 0; i < n; i++) {
      const p = points3D[PALM_POLYGON_INDICES[i]];
      const dOff = i * 3;
      const pOff = (n + i) * 3;

      this.palmPositions[dOff] = p.x + this.tmpPalmNormal.x * halfThick;
      this.palmPositions[dOff + 1] = p.y + this.tmpPalmNormal.y * halfThick;
      this.palmPositions[dOff + 2] = p.z + this.tmpPalmNormal.z * halfThick;

      this.palmPositions[pOff] = p.x - this.tmpPalmNormal.x * halfThick;
      this.palmPositions[pOff + 1] = p.y - this.tmpPalmNormal.y * halfThick;
      this.palmPositions[pOff + 2] = p.z - this.tmpPalmNormal.z * halfThick;
    }

    const cdOff = PALM_CENTER_DORSAL_IDX * 3;
    this.palmPositions[cdOff] = this.tmpPalmCenter.x + this.tmpPalmNormal.x * halfThick;
    this.palmPositions[cdOff + 1] = this.tmpPalmCenter.y + this.tmpPalmNormal.y * halfThick;
    this.palmPositions[cdOff + 2] = this.tmpPalmCenter.z + this.tmpPalmNormal.z * halfThick;

    const cpOff = PALM_CENTER_PALMAR_IDX * 3;
    this.palmPositions[cpOff] = this.tmpPalmCenter.x - this.tmpPalmNormal.x * halfThick;
    this.palmPositions[cpOff + 1] = this.tmpPalmCenter.y - this.tmpPalmNormal.y * halfThick;
    this.palmPositions[cpOff + 2] = this.tmpPalmCenter.z - this.tmpPalmNormal.z * halfThick;

    this.palmPositionAttr.needsUpdate = true;
    this.palmOccluderMesh.visible = true;
  }

  public renderHandFrame(
    cssW: number,
    cssH: number,
    dpr: number,
    rect: ImageLayoutRect,
    frame: HandSkeletonFrame | null,
    design: NailDesign | null,
    adjustment: NailAdjustment,
    ambient: DirectionalAmbientLightSample,
    mirrorX = false,
    deltaTimeSec = 1 / 60,
    calibration?: LiveFingerCalibration
  ): void {
    const renderer = this.renderer;
    if (!renderer || !this.ready) return;

    if (
      !frame ||
      !design ||
      frame.landmarks.length < HAND_LANDMARK_COUNT ||
      frame.worldLandmarks.length < HAND_LANDMARK_COUNT
    ) {
      this.clear(cssW, cssH, dpr);
      return;
    }

    this.syncViewport(cssW, cssH, dpr);

    const dt = clamp(Number.isFinite(deltaTimeSec) ? deltaTimeSec : 1 / 60, 0.001, 0.05);

    // 1. Single-phase pre-kinematic continuous One-Euro filtering across all 21 2D + 21 world landmarks
    const filtered = this.skeletonFilter.update(frame, dt);

    // 2. Single calibrated perspective projection shared by ALL 5 nails AND ALL hand occluders
    const projection = projectHandToPerspectiveMeters(
      filtered.landmarks2D,
      filtered.worldLandmarks,
      rect,
      cssW,
      cssH,
      PERSPECTIVE_FOV_DEG,
      mirrorX,
      this.projectedPoints
    );
    const points3D = projection.points3D;
    const focalPx = projection.focalPx;

    // 3. Cached off-RAF PBR texture synthesis & material binding
    this.ensureDesignPBRCache(design);

    // 4. Directional Room Lighting & Adaptive Skin-Tone Fill
    const lumExposure = clamp(0.74 + ambient.luma * 0.78, 0.72, 1.32);
    const azX = clamp(ambient.lightAzimuthX, -1, 1);
    const elY = clamp(ambient.lightElevationY, 0.15, 0.95);
    this.dirLight.position.set(azX * 1.4, elY * 1.6, 1.0);
    this.dirLight.intensity = 1.48 * lumExposure;

    this.rimLight.position.set(-azX * 1.1, -0.35, 0.7);
    this.rimLight.intensity = 0.56 * lumExposure;

    this.hemiLight.color.setRGB(
      Math.min(1, 0.74 + ambient.r * 0.32),
      Math.min(1, 0.72 + ambient.g * 0.32),
      Math.min(1, 0.7 + ambient.b * 0.32)
    );
    this.hemiLight.groundColor.setRGB(
      ambient.r * 0.62,
      ambient.g * 0.54,
      ambient.b * 0.5
    );
    this.hemiLight.intensity = 0.95 * lumExposure;
    renderer.toneMappingExposure = 0.94 + ambient.luma * 0.24;

    const fineExtMult = clamp(adjustment.extensionLength, 0.85, 1.15);
    const fineWidthMult = clamp(adjustment.scale, 0.85, 1.2);
    const rotRad = (-adjustment.rotationDeg * Math.PI) / 180;
    const undersideOpacity = clamp(adjustment.opacity, 0.7, 1.0);
    const undersideTransparent = undersideOpacity < 0.99;

    let refPalmThicknessMeters = 0.022;
    let visibleFingers = 0;

    // 5. Per-finger independent anatomical basis, real client metrics, nail + skirt + instanced occluders
    for (const fingerId of ORDERED_FINGERS) {
      const rig = this.fingerRigs.get(fingerId);
      if (!rig) continue;

      const idxSpec = FINGER_LANDMARK_INDICES[fingerId];
      const mcpPt = points3D[idxSpec.mcp];
      const pipPt = points3D[idxSpec.pip];
      const dipPt = points3D[idxSpec.dip];
      const tipPt = points3D[idxSpec.tip];

      if (!mcpPt || !pipPt || !dipPt || !tipPt) {
        this.hideRig(rig);
        continue;
      }

      visibleFingers += 1;

      const spec = this.cachedFingerSpecs?.[fingerId];
      const designPrimaryShape =
        design.detectedShape ?? this.cachedFingerSpecs?.middle?.shape ?? spec?.shape;
      const userOverrodeShape =
        designPrimaryShape !== undefined && adjustment.shape !== designPrimaryShape;
      const activeShape: NailShape = userOverrodeShape
        ? adjustment.shape
        : spec?.shape ?? adjustment.shape;
      const tipRoundness = spec?.blueprint?.geometry.tipRoundness ?? spec?.tipRoundness;
      const profileHalfWidths =
        !userOverrodeShape && spec?.blueprint?.geometry.shape === activeShape
          ? spec?.blueprint?.geometry.profileHalfWidths
          : undefined;

      // Client-native real metric dimensions (live camera scanline calibration prioritized)
      const dims = computeFingerMetricDimensions(fingerId, filtered.worldLandmarks, {
        livePoints3D: this.projectedPoints,
        calibration,
        focalPx,
      });
      if (fingerId === 'middle') {
        refPalmThicknessMeters = dims.palmThicknessMeters;
      }

      // Client owns 100% of nail width; reference `relativeWidth` NEVER overrides client finger width
      const nailWMeters = dims.nailWidthMeters * fineWidthMult;
      const nailDepthMeters = nailWMeters;

      // Real nail bed (v <= bedFraction) + proportional reference free-edge extension
      const rawBaseFreeEdge =
        spec?.blueprint?.geometry.freeEdgeRatio ??
        spec?.freeEdgeRatio ??
        Math.max(0.15, (spec?.lengthMultiplier ?? spec?.relativeLength ?? 1.35) - 1.0);
      const baseFreeEdge = clamp(rawBaseFreeEdge, 0.12, 1.15);
      const effectiveFreeEdge = clamp(baseFreeEdge * fineExtMult, 0.10, 1.25);

      const totalLenMeters = dims.bedLengthMeters * (1 + effectiveFreeEdge);
      const bedFraction = clamp(1 / (1 + effectiveFreeEdge), 0.44, 0.90);
      const quantizedBedFraction = clamp(quantizeStep(bedFraction, 0.02), 0.44, 0.90);

      // Cached per-finger parametric geometry & conformal cuticle contact skirt
      const nailGeo = this.getOrCreateNailGeometry(
        activeShape,
        quantizedBedFraction,
        tipRoundness,
        profileHalfWidths
      );
      if (rig.nailMesh.geometry !== nailGeo) {
        rig.nailMesh.geometry = nailGeo;
      }

      const skirtGeo = this.getOrCreateSkirtGeometry(activeShape, quantizedBedFraction);
      if (rig.cuticleSkirtMesh.geometry !== skirtGeo) {
        rig.cuticleSkirtMesh.geometry = skirtGeo;
      }

      applyDorsalMaterialOpacity(rig.dorsalMaterial, adjustment.opacity);
      if (rig.undersideBundle.material.transparent !== undersideTransparent) {
        rig.undersideBundle.material.transparent = undersideTransparent;
        rig.undersideBundle.material.depthWrite = !undersideTransparent;
        rig.undersideBundle.material.needsUpdate = true;
      }
      rig.undersideBundle.material.opacity = undersideOpacity;

      // Guaranteed right-handed SO(3) anatomical basis (det === +1)
      const basis = computeFingerAnatomicalBasis(
        fingerId,
        points3D,
        filtered.handedness,
        mirrorX,
        this.tmpBasisMatrix
      );
      basis.extractBasis(this.tmpAxisX, this.tmpAxisY, this.tmpAxisZ);

      this.tmpNailQuat.setFromRotationMatrix(basis);
      if (Math.abs(adjustment.rotationDeg) > 0.01) {
        this.tmpRotOffsetQuat.setFromAxisAngle(this.tmpAxisZ, rotRad);
        this.tmpNailQuat.premultiply(this.tmpRotOffsetQuat);
      }

      // Dorsal cuticle anchor strictly attached to distal cylinder surface at lerp(DIP, TIP, 0.20)
      this.tmpCuticlePos.copy(dipPt).lerp(tipPt, 0.20);
      const dorsalOffset = dims.phalanxRadiusMeters * 0.88;
      this.tmpNailPos
        .copy(this.tmpCuticlePos)
        .addScaledVector(this.tmpAxisZ, dorsalOffset);

      rig.nailMesh.position.copy(this.tmpNailPos);
      rig.nailMesh.quaternion.copy(this.tmpNailQuat);
      rig.nailMesh.scale.set(nailWMeters, totalLenMeters, nailDepthMeters);
      rig.nailMesh.visible = true;

      // Conformal Cuticle & Lateral Sulcus AO Contact Skirt aligned 1:1 with nail plate
      const skirtOpacity = clamp((this.tmpAxisZ.z + 0.05) / 0.25, 0, 1);
      if (skirtOpacity > 0.02 && adjustment.opacity > 0.2) {
        rig.cuticleSkirtMesh.position.copy(this.tmpNailPos);
        rig.cuticleSkirtMesh.quaternion.copy(this.tmpNailQuat);
        rig.cuticleSkirtMesh.scale.set(nailWMeters, totalLenMeters, nailDepthMeters);
        rig.cuticleSkirtMesh.visible = true;
      } else {
        rig.cuticleSkirtMesh.visible = false;
      }

      // Volumetric Phalanx Cylinder + Joint Sphere Instanced Occluders (renderOrder = 1)
      const distalRadius = dims.phalanxRadiusMeters;
      const middleRadius = distalRadius * 1.08;
      const proximalRadius = distalRadius * 1.16;

      const pBase = rig.fingerIndex * 3;
      this.setPhalanxInstance(pBase, mcpPt, pipPt, proximalRadius);
      this.setPhalanxInstance(pBase + 1, pipPt, dipPt, middleRadius);
      this.setPhalanxInstance(pBase + 2, dipPt, tipPt, distalRadius * 0.82);

      const jBase = rig.fingerIndex * 4;
      this.setJointInstance(jBase, mcpPt, proximalRadius * 1.03);
      this.setJointInstance(jBase + 1, pipPt, middleRadius * 1.02);
      this.setJointInstance(jBase + 2, dipPt, distalRadius * 1.0);

      // Ventral Distal Pulp Sphere: centered at lerp(DIP, TIP, 0.82) shifted -0.12*distalRadius along -axisZ
      this.tmpPulpPos
        .copy(dipPt)
        .lerp(tipPt, 0.82)
        .addScaledVector(this.tmpAxisZ, -0.12 * distalRadius);
      this.setJointInstance(jBase + 3, this.tmpPulpPos, distalRadius * 0.96);
    }

    const hasVisibleFingers = visibleFingers > 0;
    this.phalanxInstancedMesh.visible = hasVisibleFingers;
    this.jointInstancedMesh.visible = hasVisibleFingers;
    this.phalanxInstancedMesh.instanceMatrix.needsUpdate = true;
    this.jointInstancedMesh.instanceMatrix.needsUpdate = true;

    // 6. Closed Volumetric Extruded Palm / Metacarpal Occluder (renderOrder = 1)
    this.updatePalmOccluder(points3D, refPalmThicknessMeters);

    renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    for (const geo of this.nailGeometries.values()) {
      geo.dispose();
    }
    this.nailGeometries.clear();

    for (const geo of this.skirtGeometries.values()) {
      geo.dispose();
    }
    this.skirtGeometries.clear();

    for (const rig of this.fingerRigs.values()) {
      rig.dorsalMaterial.dispose();
      rig.undersideBundle.dispose();
    }
    this.fingerRigs.clear();

    this.phalanxInstancedMesh.dispose();
    this.jointInstancedMesh.dispose();
    this.cachedPBRBundles.clear();
    this.skirtMaterialBundle.material.dispose();
    this.skirtMaterialBundle.texture.dispose();
    this.palmOccluderGeo.dispose();
    this.occluderCylinderGeo.dispose();
    this.occluderSphereGeo.dispose();
    this.occluderMaterial.dispose();
    this.envMap?.dispose();
    this.envMap = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.ready = false;
  }
}


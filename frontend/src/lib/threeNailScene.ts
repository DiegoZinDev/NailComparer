import * as THREE from 'three';
import {
  BiomechanicalSignGuard,
  FINGER_LANDMARK_INDICES,
  HAND_LANDMARK_COUNT,
  HandSkeletonFilter,
  WRIST,
  computeFingerAnatomicalBasis,
  computeFingerMetricDimensions,
  projectHandToPerspectiveMeters,
} from './handKinematics';
import {
  DEFAULT_APEX_HEIGHT,
  DEFAULT_C_CURVE_DEPTH,
  V13_APEX_HEIGHT_MAX,
  V13_APEX_HEIGHT_MIN,
  V13_C_CURVE_MAX,
  V13_C_CURVE_MIN,
  V13_DIP_SPHERE_PALMAR_SHIFT,
  V13_DIP_SPHERE_RADIUS_MULT,
  V13_DISTAL_CYL_PALMAR_SHIFT,
  V13_DISTAL_CYL_RADIUS_MULT,
  V13_NAIL_DORSAL_OFFSET_MULT,
  V13_PULP_SPHERE_PALMAR_SHIFT,
  V13_PULP_SPHERE_RADIUS_MULT,
  type VolumetricNailGeometryOptions,
  createClearDropGeometry,
  createCuticleContactSkirtGeometry,
  createMetalStudGeometry,
  createPearlDomeGeometry,
  createRhinestoneGeometry,
  createVolumetricNailGeometry,
  evalNailHalfWidth,
  evaluateNailSurfacePointAndNormal,
} from './nail3DGeometry';
import type { ImageLayoutRect } from './nailRenderer';
import {
  type Accessory3DMaterialSet,
  type CuticleSkirtMaterialBundle,
  type DirectionalAmbientLightSample,
  type UndersideMaterialBundle,
  applyDorsalMaterialOpacity,
  applyFinishTypeToDorsalMaterial,
  createAccessory3DMaterials,
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

export const V13_OCCLUDER_CONSTANTS = {
  cuticleLerpT: 0.22,
  dorsalOffsetMult: V13_NAIL_DORSAL_OFFSET_MULT,
  distalCylPalmarShift: V13_DISTAL_CYL_PALMAR_SHIFT,
  distalCylRadiusMult: V13_DISTAL_CYL_RADIUS_MULT,
  dipSpherePalmarShift: V13_DIP_SPHERE_PALMAR_SHIFT,
  dipSphereRadiusMult: V13_DIP_SPHERE_RADIUS_MULT,
  pulpLerpT: 0.78,
  pulpSpherePalmarShift: V13_PULP_SPHERE_PALMAR_SHIFT,
  pulpSphereRadiusMult: V13_PULP_SPHERE_RADIUS_MULT,
} as const;

/**
 * Instanced volumetric hand occluder counts:
 * - 15 phalanx cylinders = 3 segments (proximal, middle, distal) × 5 fingers
 * - 20 joint/pulp spheres = 4 spheres (MCP, PIP, DIP, distal pulp) × 5 fingers
 */
const PHALANX_INSTANCE_COUNT = ORDERED_FINGERS.length * 3; // 15
const JOINT_INSTANCE_COUNT = ORDERED_FINGERS.length * 4; // 20
const MAX_ACCESSORY_INSTANCES = 60;

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
 * Three.js V11 Photorealistic Volumetric AR 3D Nail Scene Engine (60fps Mobile Radical Fast-Path):
 * - `preserveDrawingBuffer: false` + mobile DPR cap `<= 1.25` (desktop `<= 1.5`) + `renderNow()` on capture
 * - Entire volumetric hand occluder collapsed into **3 draw calls**:
 *   1× `InstancedMesh` (15 phalanges) + 1× `InstancedMesh` (20 joints/pulps) + 1× closed `palmOccluderMesh`
 * - Up to 4 instanced 3D accessory pools (`metalStud`, `pearl`, `rhinestone`, `clearDrop`, `renderOrder = 3`)
 *   anchored mathematically on the curved dorsal surface via `evaluateNailSurfacePointAndNormal`
 * - Supports 5-finger or 10-finger (`Left` / `Right` via `handSpecsBySide`) sets seamlessly
 * - ZERO `bumpMap` / `displacementMap` / `displacementScale`, opaque dorsal fast-path when `opacity >= 0.99`
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
  private readonly biomechSignGuard = new BiomechanicalSignGuard(8);
  private readonly projectedPoints: THREE.Vector3[] = Array.from(
    { length: HAND_LANDMARK_COUNT },
    () => new THREE.Vector3()
  );

  // Cached geometries outside RAF (keyed by shape + tipRoundness + quantized bedFraction/cCurve/apex)
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

  // V11 Pre-allocated InstancedMesh pools for true 3D nail accessories (max +4 draw calls)
  private accessoryMaterials: Accessory3DMaterialSet;
  private metalStudGeo: THREE.BufferGeometry;
  private pearlDomeGeo: THREE.BufferGeometry;
  private rhinestoneGeo: THREE.BufferGeometry;
  private clearDropGeo: THREE.BufferGeometry;
  private metalStudInstancedMesh: THREE.InstancedMesh;
  private pearlInstancedMesh: THREE.InstancedMesh;
  private rhinestoneInstancedMesh: THREE.InstancedMesh;
  private clearDropInstancedMesh: THREE.InstancedMesh;

  private fingerRigs = new Map<FingerId, FingerRig>();
  private ready = false;

  // Design & PBR bundle cache — zero texture synthesis inside RAF
  private lastDesignRef: NailDesign | null = null;
  private lastActiveHandSide: 'Left' | 'Right' = 'Right';
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
  private tmpUnitZ = new THREE.Vector3(0, 0, 1);
  private tmpPulpPos = new THREE.Vector3();
  private tmpPalmEdgeA = new THREE.Vector3();
  private tmpPalmEdgeB = new THREE.Vector3();
  private tmpPalmNormal = new THREE.Vector3();
  private tmpPalmCenter = new THREE.Vector3();
  private tmpPalmCross = new THREE.Vector3();

  // Reusable scratch objects for 3D accessory surface anchoring
  private tmpSurfaceEval = {
    position: new THREE.Vector3(),
    normal: new THREE.Vector3(),
  };
  private tmpSurfaceOpts: VolumetricNailGeometryOptions = {};
  private tmpAccWorldPos = new THREE.Vector3();
  private tmpAccWorldNormal = new THREE.Vector3();
  private tmpAccQuat = new THREE.Quaternion();
  private tmpAccScale = new THREE.Vector3();
  private tmpAccColor = new THREE.Color(0xffffff);

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

    // V11 3D Accessory Geometries & Material Set (initialized before renderer try/catch; envMap assigned once ready)
    this.metalStudGeo = createMetalStudGeometry();
    this.pearlDomeGeo = createPearlDomeGeometry();
    this.rhinestoneGeo = createRhinestoneGeometry();
    this.clearDropGeo = createClearDropGeometry();
    this.accessoryMaterials = createAccessory3DMaterials(null);

    const initAccessoryInstancedMesh = (
      geo: THREE.BufferGeometry,
      mat: THREE.MeshPhysicalMaterial
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_ACCESSORY_INSTANCES);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      mesh.visible = false;
      // Pre-allocate instanceColor buffer outside RAF
      for (let i = 0; i < MAX_ACCESSORY_INSTANCES; i++) {
        mesh.setColorAt(i, this.tmpAccColor);
      }
      if (mesh.instanceColor) {
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      this.scene.add(mesh);
      return mesh;
    };

    this.metalStudInstancedMesh = initAccessoryInstancedMesh(
      this.metalStudGeo,
      this.accessoryMaterials.metalStud
    );
    this.pearlInstancedMesh = initAccessoryInstancedMesh(
      this.pearlDomeGeo,
      this.accessoryMaterials.pearl
    );
    this.rhinestoneInstancedMesh = initAccessoryInstancedMesh(
      this.rhinestoneGeo,
      this.accessoryMaterials.rhinestone
    );
    this.clearDropInstancedMesh = initAccessoryInstancedMesh(
      this.clearDropGeo,
      this.accessoryMaterials.clearDrop
    );

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

      this.accessoryMaterials.metalStud.envMap = this.envMap;
      this.accessoryMaterials.metalStud.needsUpdate = true;
      this.accessoryMaterials.pearl.envMap = this.envMap;
      this.accessoryMaterials.pearl.needsUpdate = true;
      this.accessoryMaterials.rhinestone.envMap = this.envMap;
      this.accessoryMaterials.rhinestone.needsUpdate = true;
      this.accessoryMaterials.clearDrop.envMap = this.envMap;
      this.accessoryMaterials.clearDrop.needsUpdate = true;

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
    this.biomechSignGuard.reset();
    this.hideAll();
  }

  private getOrCreateNailGeometry(
    shape: NailShape,
    bedFraction: number,
    tipRoundness?: number,
    cCurveDepth?: number,
    apexHeight?: number
  ): THREE.BufferGeometry {
    const quantizedBed = clamp(quantizeStep(bedFraction, 0.02), 0.44, 0.90);
    const roundedQ =
      tipRoundness !== undefined ? clamp(quantizeStep(tipRoundness, 0.05), 0, 1) : 0.5;
    const cCurveQ =
      cCurveDepth !== undefined
        ? clamp(quantizeStep(cCurveDepth, 0.005), V13_C_CURVE_MIN, V13_C_CURVE_MAX)
        : DEFAULT_C_CURVE_DEPTH;
    const apexQ =
      apexHeight !== undefined
        ? clamp(quantizeStep(apexHeight, 0.004), V13_APEX_HEIGHT_MIN, V13_APEX_HEIGHT_MAX)
        : DEFAULT_APEX_HEIGHT;
    const key = `${shape}:${quantizedBed.toFixed(2)}:${roundedQ.toFixed(2)}:${cCurveQ.toFixed(3)}:${apexQ.toFixed(3)}`;

    let geo = this.nailGeometries.get(key);
    if (!geo) {
      geo = createVolumetricNailGeometry(shape, {
        tipRoundness: roundedQ,
        bedFraction: quantizedBed,
        cCurveDepth: cCurveQ,
        apexHeight: apexQ,
      });
      this.nailGeometries.set(key, geo);
    }
    return geo;
  }

  private getOrCreateSkirtGeometry(
    shape: NailShape,
    bedFraction: number,
    cCurveDepth = DEFAULT_C_CURVE_DEPTH,
    apexHeight = DEFAULT_APEX_HEIGHT
  ): THREE.BufferGeometry {
    const quantizedBed = clamp(quantizeStep(bedFraction, 0.02), 0.44, 0.90);
    const cCurveQ = clamp(
      quantizeStep(cCurveDepth, 0.005),
      V13_C_CURVE_MIN,
      V13_C_CURVE_MAX
    );
    const apexQ = clamp(
      quantizeStep(apexHeight, 0.004),
      V13_APEX_HEIGHT_MIN,
      V13_APEX_HEIGHT_MAX
    );
    const key = `${shape}:${quantizedBed.toFixed(2)}:${cCurveQ.toFixed(3)}:${apexQ.toFixed(3)}`;
    let geo = this.skirtGeometries.get(key);
    if (!geo) {
      geo = createCuticleContactSkirtGeometry(shape, quantizedBed, cCurveQ, apexQ);
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

  private hideAccessories(): void {
    this.metalStudInstancedMesh.count = 0;
    this.metalStudInstancedMesh.visible = false;
    this.pearlInstancedMesh.count = 0;
    this.pearlInstancedMesh.visible = false;
    this.rhinestoneInstancedMesh.count = 0;
    this.rhinestoneInstancedMesh.visible = false;
    this.clearDropInstancedMesh.count = 0;
    this.clearDropInstancedMesh.visible = false;
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
    this.hideAccessories();
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

  private resolveActiveFingerSpecMap(
    design: NailDesign,
    handedness: 'Left' | 'Right'
  ): Record<FingerId, NailFingerDesignSpec> {
    const sideSpecs = design.handSpecsBySide?.[handedness];
    if (sideSpecs) {
      const mergedDesign: NailDesign = {
        ...design,
        fingerSpecs: sideSpecs,
      };
      return buildFingerSpecsFromStudioDesign(mergedDesign);
    }
    return buildFingerSpecsFromStudioDesign(design);
  }

  private computeDesignKey(design: NailDesign, activeHandSide: 'Left' | 'Right'): string {
    const sideSpecs = design.handSpecsBySide?.[activeHandSide];
    const resolvedSpecs = sideSpecs ?? design.fingerSpecs;
    let fingerSpecsPart = '';
    if (resolvedSpecs) {
      fingerSpecsPart = ORDERED_FINGERS.map((id) => {
        const s = resolvedSpecs[id];
        if (!s) return '';
        const mSpec = s.manufacturingSpec;
        const mSig = mSpec
          ? `:${mSpec.renderStrategy ?? ''}:${mSpec.finishType}:${mSpec.trueBaseColorHex}:${mSpec.metalness.toFixed(2)}:${mSpec.roughness.toFixed(2)}:${mSpec.cCurveDepth.toFixed(2)}:${mSpec.apexHeight.toFixed(3)}:${mSpec.strokes3D.length}:${mSpec.accessories3D.length}`
          : '';
        return `${id}:${s.shape}:${s.renderStrategy ?? ''}:${(s.freeEdgeRatio ?? 0).toFixed(2)}:${(s.lengthMultiplier ?? s.relativeLength).toFixed(2)}:${s.hasMetallicOutline ? s.outlineColor ?? '1' : '0'}:${hashFingerSpec(s)}${mSig}`;
      }).join('~');
    }
    const sideKey = design.handSpecsBySide ? activeHandSide : 'any';
    return `${design.id}|${sideKey}|${design.name}|${design.baseColor}|${design.secondaryColor ?? ''}|${design.accentColor ?? ''}|${design.finish}|${design.patternType}|${design.imageDataUrl ? design.imageDataUrl.length : 0}|${fingerSpecsPart}`;
  }

  private paintMetallicOutlineOnBundle(
    bundle: ProceduralPBRBundle,
    shape: NailShape,
    outlineColor: string,
    bedFraction: number
  ): void {
    const traceSilhouette = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const steps = 40;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const v = 0.05 + (i / steps) * 0.935;
        const hw = evalNailHalfWidth(v, shape, { bedFraction }) * 0.91;
        const u = 0.5 - hw * 0.96;
        const x = u * w;
        const y = (1 - v) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const v = 0.05 + (i / steps) * 0.935;
        const hw = evalNailHalfWidth(v, shape, { bedFraction }) * 0.91;
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

  private ensureDesignPBRCache(
    design: NailDesign,
    activeHandSide: 'Left' | 'Right'
  ): void {
    const hasSideMap = Boolean(design.handSpecsBySide);
    if (
      design === this.lastDesignRef &&
      this.cachedFingerSpecs &&
      (!hasSideMap || activeHandSide === this.lastActiveHandSide)
    ) {
      return;
    }

    const key = this.computeDesignKey(design, activeHandSide);
    if (
      key === this.activeDesignKey &&
      this.cachedFingerSpecs &&
      (!hasSideMap || activeHandSide === this.lastActiveHandSide)
    ) {
      this.lastDesignRef = design;
      this.lastActiveHandSide = activeHandSide;
      return;
    }

    this.lastDesignRef = design;
    this.lastActiveHandSide = activeHandSide;
    this.activeDesignKey = key;

    const specs = this.resolveActiveFingerSpecMap(design, activeHandSide);
    this.cachedFingerSpecs = specs;
    this.cachedPBRBundles.clear();

    for (const id of ORDERED_FINGERS) {
      const spec = specs[id];
      const bundle = synthesizeProceduralPBRBundle(spec);

      if (spec.hasMetallicOutline && spec.outlineColor && !spec.blueprint && !spec.manufacturingSpec) {
        const freeEdge = clamp(
          spec.freeEdgeRatio ??
            Math.max(0.15, (spec.lengthMultiplier ?? spec.relativeLength ?? 1.35) - 1.0),
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

      const mSpec = spec.manufacturingSpec;
      const renderStrategy = spec.renderStrategy ?? mSpec?.renderStrategy;
      const mSig = mSpec
        ? `|m13:${renderStrategy ?? ''}:${mSpec.finishType}:${mSpec.metalness.toFixed(2)}:${mSpec.roughness.toFixed(2)}:${mSpec.clearcoat.toFixed(2)}:${mSpec.strokes3D.length}`
        : `|s13:${renderStrategy ?? ''}`;
      const fullRigHash = `${bundle.specHash}${mSig}`;

      if (rig.currentSpecHash !== fullRigHash) {
        rig.dorsalMaterial.map = bundle.map;
        rig.dorsalMaterial.normalMap = bundle.normalMap;
        rig.dorsalMaterial.roughnessMap = bundle.roughnessMap;
        rig.dorsalMaterial.metalnessMap = bundle.metalnessMap;
        rig.dorsalMaterial.alphaMap = bundle.alphaMap;

        const useProceduralChromePath =
          renderStrategy === 'procedural_pbr_3d' ||
          (mSpec?.finishType === 'mirror_chrome' &&
            renderStrategy !== 'canonical_uv_delighted' &&
            renderStrategy !== 'hybrid_uv_plus_pbr_3d');

        if (spec.trueUvDataUrl && !useProceduralChromePath) {
          rig.dorsalMaterial.metalness = 1.0;
          rig.dorsalMaterial.roughness = 1.0;
          rig.dorsalMaterial.clearcoat = 1.0;
          rig.dorsalMaterial.clearcoatRoughness = 0.03;
          rig.dorsalMaterial.iridescence = 0.12;
          rig.dorsalMaterial.envMapIntensity = 1.9;
          rig.dorsalMaterial.normalScale.set(1.15, 1.15);
          rig.dorsalMaterial.transparent = true;
          rig.dorsalMaterial.alphaTest = 0;
          rig.dorsalMaterial.premultipliedAlpha = false;
          rig.dorsalMaterial.depthWrite = true;
          rig.dorsalMaterial.needsUpdate = true;
        } else if (mSpec) {
          applyFinishTypeToDorsalMaterial(rig.dorsalMaterial, mSpec.finishType, {
            metalness: mSpec.metalness,
            roughness: mSpec.roughness,
            clearcoat: mSpec.clearcoat,
          });
          const hasReliefStrokes =
            mSpec.strokes3D.some((st) => st.reliefHeight > 0.05) || mSpec.borderIs3DRaised;
          if (mSpec.finishType === 'mirror_chrome') {
            const chromeNormal = hasReliefStrokes ? 0.95 : 0.15;
            rig.dorsalMaterial.normalScale.set(chromeNormal, chromeNormal);
          } else {
            const nScale = hasReliefStrokes ? 1.35 : 0.95;
            rig.dorsalMaterial.normalScale.set(nScale, nScale);
          }
          rig.dorsalMaterial.needsUpdate = true;
        } else {
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

          const nScale = isRelief ? 1.45 : isChrome ? 0.15 : 1.05;
          rig.dorsalMaterial.normalScale.set(nScale, nScale);
          rig.dorsalMaterial.metalness = 1.0;
          rig.dorsalMaterial.roughness = 1.0;
          rig.dorsalMaterial.iridescence = spec.finishStyle === 'pearl_glazed' ? 0.55 : 0.0;
          rig.dorsalMaterial.clearcoat = isVelvet ? 0.42 : 1.0;
          rig.dorsalMaterial.clearcoatRoughness = isVelvet
            ? 0.34
            : isChrome
              ? 0.018
              : 0.035;
          rig.dorsalMaterial.envMapIntensity = isChrome
            ? 2.45
            : isVelvet
              ? 0.9
              : 1.5;
          rig.dorsalMaterial.needsUpdate = true;
        }

        rig.currentSpecHash = fullRigHash;
      }

      const undersideBase =
        mSpec?.trueBaseColorHex || spec.baseColor || '#E6D5C8';
      updateUndersideMaterialTint(rig.undersideBundle, undersideBase);
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

  private finalizeAccessoryMesh(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.visible = count > 0;
    if (count > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
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

    // 3. Biomechanical handedness sign guard (8-frame hysteresis) + cached off-RAF PBR binding
    const effectiveHandedness = this.biomechSignGuard.update(
      points3D,
      filtered.handedness,
      mirrorX
    );
    this.ensureDesignPBRCache(design, effectiveHandedness);

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
    const baseOpacity = clamp(adjustment.opacity, 0.7, 1.0);

    let refPalmThicknessMeters = 0.022;
    let middleWidthMeters = 0.0125;
    let visibleFingers = 0;

    let metalCount = 0;
    let pearlCount = 0;
    let rhinestoneCount = 0;
    let clearDropCount = 0;

    // 5. Per-finger independent anatomical basis, real client metrics, nail + skirt + occluders + 3D accessories
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

      const sideSpec =
        design.handSpecsBySide?.[effectiveHandedness]?.[fingerId] ??
        design.fingerSpecs?.[fingerId];
      const spec = sideSpec ?? this.cachedFingerSpecs?.[fingerId];
      const mSpec = spec?.manufacturingSpec;

      const designPrimaryShape =
        design.detectedShape ??
        this.cachedFingerSpecs?.middle?.shape ??
        mSpec?.shape ??
        spec?.shape;
      const userOverrodeShape =
        designPrimaryShape !== undefined && adjustment.shape !== designPrimaryShape;
      const activeShape: NailShape = userOverrodeShape
        ? adjustment.shape
        : mSpec?.shape ?? spec?.shape ?? adjustment.shape;
      const tipRoundness =
        mSpec?.tipRoundness ?? spec?.blueprint?.geometry.tipRoundness ?? spec?.tipRoundness;
      const cCurveDepth = clamp(
        mSpec?.cCurveDepth ?? DEFAULT_C_CURVE_DEPTH,
        V13_C_CURVE_MIN,
        V13_C_CURVE_MAX
      );
      const apexHeight = clamp(
        mSpec?.apexHeight ?? DEFAULT_APEX_HEIGHT,
        V13_APEX_HEIGHT_MIN,
        V13_APEX_HEIGHT_MAX
      );

      // Client-native real metric dimensions (live camera scanline calibration prioritized)
      const dims = computeFingerMetricDimensions(fingerId, filtered.worldLandmarks, {
        livePoints3D: this.projectedPoints,
        calibration,
        focalPx,
      });
      if (fingerId === 'middle') {
        refPalmThicknessMeters = dims.palmThicknessMeters;
        middleWidthMeters = dims.nailWidthMeters;
      }

      // V12 Pinky anti-collapse floor: guarantees all 5 fingers stay stable & well-proportioned
      const safeNailWidthMeters =
        fingerId === 'pinky'
          ? Math.max(dims.nailWidthMeters, Math.max(0.0082, middleWidthMeters * 0.68))
          : dims.nailWidthMeters;
      const safeBedLengthMeters =
        fingerId === 'pinky' ? Math.max(dims.bedLengthMeters, 0.0078) : dims.bedLengthMeters;

      // V13 Realistic Nail Bed Width: avoids overhanging past lateral skin folds
      const nailWMeters = safeNailWidthMeters * 0.94 * fineWidthMult;
      const nailDepthMeters = nailWMeters;

      // Real nail bed (v <= bedFraction) + proportional reference free-edge extension
      const rawBaseFreeEdge =
        mSpec?.freeEdgeRatio ??
        spec?.blueprint?.geometry.freeEdgeRatio ??
        spec?.freeEdgeRatio ??
        Math.max(0.15, (spec?.lengthMultiplier ?? spec?.relativeLength ?? 1.35) - 1.0);
      const baseFreeEdge = clamp(rawBaseFreeEdge, 0.12, 1.15);
      const effectiveFreeEdge = clamp(baseFreeEdge * fineExtMult, 0.10, 1.25);

      const totalLenMeters = safeBedLengthMeters * (1 + effectiveFreeEdge);
      const bedFraction = clamp(1 / (1 + effectiveFreeEdge), 0.44, 0.90);
      const quantizedBedFraction = clamp(quantizeStep(bedFraction, 0.02), 0.44, 0.90);

      // Cached per-finger clean parametric geometry & conformal cuticle contact skirt
      const nailGeo = this.getOrCreateNailGeometry(
        activeShape,
        quantizedBedFraction,
        tipRoundness,
        cCurveDepth,
        apexHeight
      );
      if (rig.nailMesh.geometry !== nailGeo) {
        rig.nailMesh.geometry = nailGeo;
      }

      const skirtGeo = this.getOrCreateSkirtGeometry(
        activeShape,
        quantizedBedFraction,
        cCurveDepth,
        apexHeight
      );
      if (rig.cuticleSkirtMesh.geometry !== skirtGeo) {
        rig.cuticleSkirtMesh.geometry = skirtGeo;
      }

      // Guaranteed right-handed SO(3) anatomical basis (det === +1)
      const basis = computeFingerAnatomicalBasis(
        fingerId,
        points3D,
        effectiveHandedness,
        mirrorX,
        this.tmpBasisMatrix
      );
      basis.extractBasis(this.tmpAxisX, this.tmpAxisY, this.tmpAxisZ);

      this.tmpNailQuat.setFromRotationMatrix(basis);
      if (Math.abs(adjustment.rotationDeg) > 0.01) {
        this.tmpRotOffsetQuat.setFromAxisAngle(this.tmpAxisZ, rotRad);
        this.tmpNailQuat.premultiply(this.tmpRotOffsetQuat);
      }

      // V13 Palmar Anti-Bleed Visibility Gate:
      // - When palm faces camera (`axisZ.z < -0.35`): hide dorsal plate (Group 0) and cuticle skirt completely;
      //   only show ventral free-edge cavity (Group 1) when `effectiveFreeEdge > 0.28`, fading smoothly to 0 by `axisZ.z < -0.55`.
      // - Smooth fade across `-0.15 .. -0.35` before dorsal cutoff.
      const axisZz = this.tmpAxisZ.z;
      const isPalmFacing = axisZz < -0.35;
      const dorsalFade = isPalmFacing
        ? 0
        : axisZz < -0.15
          ? clamp((axisZz + 0.35) / 0.20, 0, 1)
          : 1;
      const effectiveDorsalOpacity = baseOpacity * dorsalFade;
      rig.dorsalMaterial.visible = !isPalmFacing && effectiveDorsalOpacity > 0.01;
      applyDorsalMaterialOpacity(rig.dorsalMaterial, effectiveDorsalOpacity);

      let showVentralCavity = true;
      let effectiveUndersideOpacity = baseOpacity;
      if (isPalmFacing) {
        if (effectiveFreeEdge <= 0.28 || axisZz < -0.55) {
          showVentralCavity = false;
          effectiveUndersideOpacity = 0;
        } else {
          const ventralFade = clamp((axisZz + 0.55) / 0.20, 0, 1);
          effectiveUndersideOpacity = baseOpacity * ventralFade;
          showVentralCavity = effectiveUndersideOpacity > 0.01;
        }
      }
      rig.undersideBundle.material.visible = showVentralCavity;
      const undersideTransparent = effectiveUndersideOpacity < 0.99;
      if (rig.undersideBundle.material.transparent !== undersideTransparent) {
        rig.undersideBundle.material.transparent = undersideTransparent;
        rig.undersideBundle.material.depthWrite = !undersideTransparent;
        rig.undersideBundle.material.needsUpdate = true;
      }
      rig.undersideBundle.material.opacity = effectiveUndersideOpacity;

      // Dorsal cuticle anchor attached cleanly at lerp(DIP, TIP, 0.22) with zero-clipping dorsal offset
      this.tmpCuticlePos.copy(dipPt).lerp(tipPt, V13_OCCLUDER_CONSTANTS.cuticleLerpT);
      const dorsalOffset =
        dims.phalanxRadiusMeters * V13_OCCLUDER_CONSTANTS.dorsalOffsetMult;
      this.tmpNailPos
        .copy(this.tmpCuticlePos)
        .addScaledVector(this.tmpAxisZ, dorsalOffset);

      rig.nailMesh.position.copy(this.tmpNailPos);
      rig.nailMesh.quaternion.copy(this.tmpNailQuat);
      rig.nailMesh.scale.set(nailWMeters, totalLenMeters, nailDepthMeters);
      rig.nailMesh.visible = rig.dorsalMaterial.visible || rig.undersideBundle.material.visible;
      rig.nailMesh.updateMatrixWorld();

      // Anchor true 3D geometric accessories (ALWAYS active regardless of trueUvDataUrl when dorsal is visible)
      const accessories = mSpec?.accessories3D;
      if (
        accessories &&
        accessories.length > 0 &&
        axisZz >= -0.25 &&
        adjustment.opacity > 0.25
      ) {
        this.tmpSurfaceOpts.bedFraction = quantizedBedFraction;
        this.tmpSurfaceOpts.tipRoundness = tipRoundness;
        this.tmpSurfaceOpts.cCurveDepth = cCurveDepth;
        this.tmpSurfaceOpts.apexHeight = apexHeight;

        const invScaleX = 1 / Math.max(1e-6, nailWMeters);
        const invScaleY = 1 / Math.max(1e-6, totalLenMeters);
        const invScaleZ = 1 / Math.max(1e-6, nailDepthMeters);

        for (let aIdx = 0; aIdx < accessories.length; aIdx++) {
          const acc = accessories[aIdx];
          evaluateNailSurfacePointAndNormal(
            acc.u,
            acc.v,
            activeShape,
            this.tmpSurfaceOpts,
            this.tmpSurfaceEval
          );

          // Local -> World position using nailMesh world matrix
          this.tmpAccWorldPos
            .copy(this.tmpSurfaceEval.position)
            .applyMatrix4(rig.nailMesh.matrixWorld);

          // Local surface normal -> World unit normal: normalize(nLocal * invScale) rotated by nailMesh.quaternion
          this.tmpAccWorldNormal
            .set(
              this.tmpSurfaceEval.normal.x * invScaleX,
              this.tmpSurfaceEval.normal.y * invScaleY,
              this.tmpSurfaceEval.normal.z * invScaleZ
            )
            .normalize()
            .applyQuaternion(rig.nailMesh.quaternion)
            .normalize();

          const rWorld = clamp(
            acc.radiusNorm * nailWMeters * 0.5,
            0.00035,
            nailWMeters * 0.24
          );
          const heightFactor = acc.kind === 'metal_stud_flat' ? 0.55 : acc.heightRatio * 1.4;
          const hWorld = rWorld * heightFactor;

          // Seat slightly embedded (0.22 * hWorld) along surface normal so zero gaps/floating occur
          this.tmpAccWorldPos.addScaledVector(this.tmpAccWorldNormal, hWorld * 0.22);
          this.tmpAccQuat.setFromUnitVectors(this.tmpUnitZ, this.tmpAccWorldNormal);
          this.tmpAccScale.set(rWorld, rWorld, hWorld);
          this.tmpInstanceMatrix.compose(
            this.tmpAccWorldPos,
            this.tmpAccQuat,
            this.tmpAccScale
          );
          this.tmpAccColor.set(acc.colorHex || '#FFFFFF');

          if (
            acc.kind === 'metal_stud_sphere' ||
            acc.kind === 'metal_stud_flat' ||
            acc.kind === 'caviar_bead'
          ) {
            if (metalCount < MAX_ACCESSORY_INSTANCES) {
              this.metalStudInstancedMesh.setMatrixAt(metalCount, this.tmpInstanceMatrix);
              this.metalStudInstancedMesh.setColorAt(metalCount, this.tmpAccColor);
              metalCount += 1;
            }
          } else if (acc.kind === 'pearl_dome') {
            if (pearlCount < MAX_ACCESSORY_INSTANCES) {
              this.pearlInstancedMesh.setMatrixAt(pearlCount, this.tmpInstanceMatrix);
              this.pearlInstancedMesh.setColorAt(pearlCount, this.tmpAccColor);
              pearlCount += 1;
            }
          } else if (acc.kind === 'rhinestone') {
            if (rhinestoneCount < MAX_ACCESSORY_INSTANCES) {
              this.rhinestoneInstancedMesh.setMatrixAt(
                rhinestoneCount,
                this.tmpInstanceMatrix
              );
              this.rhinestoneInstancedMesh.setColorAt(rhinestoneCount, this.tmpAccColor);
              rhinestoneCount += 1;
            }
          } else if (acc.kind === '3d_drop_clear') {
            if (clearDropCount < MAX_ACCESSORY_INSTANCES) {
              this.clearDropInstancedMesh.setMatrixAt(clearDropCount, this.tmpInstanceMatrix);
              this.clearDropInstancedMesh.setColorAt(clearDropCount, this.tmpAccColor);
              clearDropCount += 1;
            }
          }
        }
      }

      // Conformal Cuticle & Lateral Sulcus AO Contact Skirt aligned 1:1 with nail plate (hidden on palm view)
      const skirtOpacity = isPalmFacing ? 0 : clamp((axisZz + 0.05) / 0.25, 0, 1);
      if (skirtOpacity > 0.02 && adjustment.opacity > 0.2 && !isPalmFacing) {
        rig.cuticleSkirtMesh.position.copy(this.tmpNailPos);
        rig.cuticleSkirtMesh.quaternion.copy(this.tmpNailQuat);
        rig.cuticleSkirtMesh.scale.set(nailWMeters, totalLenMeters, nailDepthMeters);
        rig.cuticleSkirtMesh.visible = true;
      } else {
        rig.cuticleSkirtMesh.visible = false;
      }

      // Volumetric Phalanx Cylinder + Joint Sphere Instanced Occluders (renderOrder = 1)
      // Zero-Clipping Palmar Clearance: dorsal ceiling stays strictly below cuticle bed
      const distalRadius = dims.phalanxRadiusMeters;
      const middleRadius = distalRadius * 1.08;
      const proximalRadius = distalRadius * 1.16;

      const pBase = rig.fingerIndex * 3;
      this.setPhalanxInstance(pBase, mcpPt, pipPt, proximalRadius);
      this.setPhalanxInstance(pBase + 1, pipPt, dipPt, middleRadius);

      // Distal cylinder shifted palmarly (-0.32 * r) with radius 0.66 * r => dorsal ceiling +0.34 * r
      this.tmpRodCenter
        .copy(dipPt)
        .addScaledVector(this.tmpAxisZ, V13_OCCLUDER_CONSTANTS.distalCylPalmarShift * distalRadius);
      this.tmpPulpPos
        .copy(tipPt)
        .addScaledVector(this.tmpAxisZ, V13_OCCLUDER_CONSTANTS.distalCylPalmarShift * distalRadius);
      this.setPhalanxInstance(
        pBase + 2,
        this.tmpRodCenter,
        this.tmpPulpPos,
        distalRadius * V13_OCCLUDER_CONSTANTS.distalCylRadiusMult
      );

      const jBase = rig.fingerIndex * 4;
      this.setJointInstance(jBase, mcpPt, proximalRadius * 1.03);
      this.setJointInstance(jBase + 1, pipPt, middleRadius * 1.02);

      // DIP joint sphere shifted palmarly (-0.24 * r) with radius 0.76 * r => dorsal ceiling +0.52 * r
      this.tmpPulpPos
        .copy(dipPt)
        .addScaledVector(this.tmpAxisZ, V13_OCCLUDER_CONSTANTS.dipSpherePalmarShift * distalRadius);
      this.setJointInstance(
        jBase + 2,
        this.tmpPulpPos,
        distalRadius * V13_OCCLUDER_CONSTANTS.dipSphereRadiusMult
      );

      // Ventral Distal Pulp Sphere: lerp(DIP, TIP, 0.78) shifted -0.36 * r with radius 0.76 * r => dorsal ceiling +0.40 * r
      this.tmpPulpPos
        .copy(dipPt)
        .lerp(tipPt, V13_OCCLUDER_CONSTANTS.pulpLerpT)
        .addScaledVector(this.tmpAxisZ, V13_OCCLUDER_CONSTANTS.pulpSpherePalmarShift * distalRadius);
      this.setJointInstance(
        jBase + 3,
        this.tmpPulpPos,
        distalRadius * V13_OCCLUDER_CONSTANTS.pulpSphereRadiusMult
      );
    }

    this.finalizeAccessoryMesh(this.metalStudInstancedMesh, metalCount);
    this.finalizeAccessoryMesh(this.pearlInstancedMesh, pearlCount);
    this.finalizeAccessoryMesh(this.rhinestoneInstancedMesh, rhinestoneCount);
    this.finalizeAccessoryMesh(this.clearDropInstancedMesh, clearDropCount);

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

    this.metalStudInstancedMesh.dispose();
    this.pearlInstancedMesh.dispose();
    this.rhinestoneInstancedMesh.dispose();
    this.clearDropInstancedMesh.dispose();
    this.metalStudGeo.dispose();
    this.pearlDomeGeo.dispose();
    this.rhinestoneGeo.dispose();
    this.clearDropGeo.dispose();
    this.accessoryMaterials.dispose();

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


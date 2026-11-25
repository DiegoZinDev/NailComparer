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
  NailAdjustment,
  NailDesign,
  NailShape,
} from '../types/nail';

const PERSPECTIVE_FOV_DEG = 58;
const PERSPECTIVE_NEAR = 0.01;
const PERSPECTIVE_FAR = 10.0;

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

interface FingerRig {
  fingerId: FingerId;
  nailMesh: THREE.Mesh;
  dorsalMaterial: THREE.MeshPhysicalMaterial;
  undersideBundle: UndersideMaterialBundle;
  cuticleSkirtMesh: THREE.Mesh;
  proximalRodMesh: THREE.Mesh;
  middleRodMesh: THREE.Mesh;
  distalRodMesh: THREE.Mesh;
  mcpJointMesh: THREE.Mesh;
  pipJointMesh: THREE.Mesh;
  dipJointMesh: THREE.Mesh;
  distalPulpMesh: THREE.Mesh;
  currentSpecHash: string;
}

/**
 * Three.js V9 Photorealistic Volumetric AR 3D Nail Scene Engine:
 * - Calibrated `PerspectiveCamera(58, cssW / cssH, 0.01, 10.0)` at origin `(0, 0, 0)` looking `-Z`
 * - Single-phase pre-kinematic `HandSkeletonFilter` + `projectHandToPerspectiveMeters` invariant:
 *   all 5 nail rigs AND all hand occluders (palm + phalanges + joints + distal pulps) read from
 *   the exact same filtered 21-point 3D metric coordinate array per frame
 * - Per-finger independent SO(3) anatomical basis (`det === +1`) & dorsal surface attachment
 *   (`cuticlePos + axisZ * (phalanxRadiusMeters * 0.88)`)
 * - Zero `requestAnimationFrame` allocations: pre-allocated palm occluder vertex buffer, shared
 *   unit cylinder/sphere occluder geometries, and off-RAF cached PBR + geometry maps
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

  // Cached geometries outside RAF (keyed by shape + tipRoundness)
  private nailGeometries = new Map<string, THREE.BufferGeometry>();
  private skirtGeometries = new Map<NailShape, THREE.BufferGeometry>();

  // Shared conformal cuticle skirt material & volumetric occluder primitives
  private skirtMaterialBundle: CuticleSkirtMaterialBundle;
  private occluderMaterial: THREE.MeshBasicMaterial;
  private unitCylinderGeo: THREE.CylinderGeometry;
  private unitSphereGeo: THREE.SphereGeometry;

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

    const initAspect =
      canvas.clientWidth > 0 && canvas.clientHeight > 0
        ? canvas.clientWidth / canvas.clientHeight
        : 9 / 16;
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
    this.unitCylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    this.unitSphereGeo = new THREE.SphereGeometry(1, 12, 10);

    // Pre-allocated closed extruded 7-gon palm occluder (16 vertices: 7 dorsal + 7 palmar + 2 centers)
    this.palmPositions = new Float32Array(PALM_TOTAL_VERTICES * 3);
    this.palmPositionAttr = new THREE.BufferAttribute(this.palmPositions, 3);
    this.palmPositionAttr.setUsage(THREE.DynamicDrawUsage);

    const palmIndices: number[] = [];
    const n = PALM_VERTS_PER_FACE;
    // Dorsal face fan (counter-clockwise looking along +palmNormal)
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      palmIndices.push(PALM_CENTER_DORSAL_IDX, i, next);
    }
    // Palmar face fan (reversed winding for outward -palmNormal)
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      palmIndices.push(PALM_CENTER_PALMAR_IDX, n + next, n + i);
    }
    // Closed side walls connecting dorsal ring (0..n-1) and palmar ring (n..2n-1)
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

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.06;
      this.renderer = renderer;

      this.envMap = createStudioRoomEnvMap(renderer);
      this.scene.environment = this.envMap;

      const defaultNailGeo = this.getOrCreateNailGeometry('almond', 0.5);
      const defaultSkirtGeo = this.getOrCreateSkirtGeometry('almond');

      const makeOccluderMesh = (geo: THREE.BufferGeometry): THREE.Mesh => {
        const mesh = new THREE.Mesh(geo, this.occluderMaterial);
        mesh.renderOrder = 1;
        mesh.frustumCulled = false;
        mesh.visible = false;
        this.scene.add(mesh);
        return mesh;
      };

      for (const id of ORDERED_FINGERS) {
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
          nailMesh,
          dorsalMaterial,
          undersideBundle,
          cuticleSkirtMesh,
          proximalRodMesh: makeOccluderMesh(this.unitCylinderGeo),
          middleRodMesh: makeOccluderMesh(this.unitCylinderGeo),
          distalRodMesh: makeOccluderMesh(this.unitCylinderGeo),
          mcpJointMesh: makeOccluderMesh(this.unitSphereGeo),
          pipJointMesh: makeOccluderMesh(this.unitSphereGeo),
          dipJointMesh: makeOccluderMesh(this.unitSphereGeo),
          distalPulpMesh: makeOccluderMesh(this.unitSphereGeo),
          currentSpecHash: '',
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

  public resetTracking(): void {
    this.skeletonFilter.reset();
    this.hideAll();
  }

  private getOrCreateNailGeometry(
    shape: NailShape,
    tipRoundness?: number
  ): THREE.BufferGeometry {
    const roundedQ =
      tipRoundness !== undefined ? Math.round(clamp(tipRoundness, 0, 1) * 20) / 20 : 0.5;
    const key = `${shape}:${roundedQ.toFixed(2)}`;
    let geo = this.nailGeometries.get(key);
    if (!geo) {
      geo = createVolumetricNailGeometry(shape, { tipRoundness: roundedQ });
      this.nailGeometries.set(key, geo);
    }
    return geo;
  }

  private getOrCreateSkirtGeometry(shape: NailShape): THREE.BufferGeometry {
    let geo = this.skirtGeometries.get(shape);
    if (!geo) {
      geo = createCuticleContactSkirtGeometry(shape);
      this.skirtGeometries.set(shape, geo);
    }
    return geo;
  }

  private syncViewport(cssW: number, cssH: number, dpr: number): void {
    const renderer = this.renderer;
    if (!renderer) return;

    const clampedDpr = Math.min(dpr, 1.5);
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

  private hideRig(rig: FingerRig): void {
    rig.nailMesh.visible = false;
    rig.cuticleSkirtMesh.visible = false;
    rig.proximalRodMesh.visible = false;
    rig.middleRodMesh.visible = false;
    rig.distalRodMesh.visible = false;
    rig.mcpJointMesh.visible = false;
    rig.pipJointMesh.visible = false;
    rig.dipJointMesh.visible = false;
    rig.distalPulpMesh.visible = false;
  }

  private hideAll(): void {
    this.palmOccluderMesh.visible = false;
    for (const rig of this.fingerRigs.values()) {
      this.hideRig(rig);
    }
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
        return `${id}:${s.shape}:${(s.extensionMm ?? 0).toFixed(1)}:${(s.lengthMultiplier ?? s.relativeLength).toFixed(2)}:${s.hasMetallicOutline ? s.outlineColor ?? '1' : '0'}:${hashFingerSpec(s)}`;
      }).join('~');
    }
    return `${design.id}|${design.name}|${design.baseColor}|${design.secondaryColor ?? ''}|${design.accentColor ?? ''}|${design.finish}|${design.patternType}|${design.imageDataUrl ? design.imageDataUrl.length : 0}|${fingerSpecsPart}`;
  }

  private paintMetallicOutlineOnBundle(
    bundle: ProceduralPBRBundle,
    shape: NailShape,
    outlineColor: string
  ): void {
    const traceSilhouette = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const steps = 40;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const v = 0.05 + (i / steps) * 0.935;
        const hw = evalNailHalfWidth(v, shape) * 0.91;
        const u = 0.5 - hw * 0.96;
        const x = u * w;
        const y = (1 - v) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
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

      if (spec.hasMetallicOutline && spec.outlineColor) {
        this.paintMetallicOutlineOnBundle(bundle, spec.shape, spec.outlineColor);
      }

      this.cachedPBRBundles.set(id, bundle);

      const rig = this.fingerRigs.get(id);
      if (!rig) continue;

      if (rig.currentSpecHash !== bundle.specHash) {
        rig.dorsalMaterial.map = bundle.map;
        rig.dorsalMaterial.normalMap = bundle.normalMap;
        rig.dorsalMaterial.bumpMap = bundle.bumpMap;
        rig.dorsalMaterial.displacementMap = bundle.displacementMap;
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

        rig.dorsalMaterial.displacementScale = spec.has3DRelief ? 0.0005 : 0.00022;
        rig.dorsalMaterial.displacementBias = 0;

        const nScale = isRelief ? 1.45 : isChrome ? 0.85 : 1.05;
        rig.dorsalMaterial.normalScale.set(nScale, nScale);
        rig.dorsalMaterial.bumpScale = isRelief ? 0.00045 : 0.00018;
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

  private positionCylinderSegment(
    mesh: THREE.Mesh,
    start: THREE.Vector3,
    end: THREE.Vector3,
    radiusMeters: number
  ): void {
    this.tmpRodDir.subVectors(end, start);
    const len = this.tmpRodDir.length();
    if (len < 1e-4) {
      mesh.visible = false;
      return;
    }

    this.tmpRodDir.divideScalar(len);
    this.tmpRodQuat.setFromUnitVectors(this.tmpUpY, this.tmpRodDir);
    this.tmpRodCenter.copy(start).addScaledVector(this.tmpRodDir, len * 0.5);

    mesh.position.copy(this.tmpRodCenter);
    mesh.quaternion.copy(this.tmpRodQuat);
    // Uniform X/Z scale on unit cylinder
    mesh.scale.set(radiusMeters, len, radiusMeters);
    mesh.visible = true;
  }

  private positionJointSphere(
    mesh: THREE.Mesh,
    center: THREE.Vector3,
    radiusMeters: number
  ): void {
    mesh.position.copy(center);
    mesh.scale.setScalar(radiusMeters);
    mesh.visible = true;
  }

  /**
   * Updates the pre-allocated closed extruded 7-gon palm occluder directly in `this.palmPositions`
   * (zero per-frame heap allocation) using the exact same `this.projectedPoints` array.
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

    // Compute centroid of the 7-point palm polygon
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

    // Compute palm face normal and ensure winding matches polygon order
    this.tmpPalmEdgeA.subVectors(indexMcp, wrist);
    this.tmpPalmEdgeB.subVectors(pinkyMcp, wrist);
    this.tmpPalmNormal.crossVectors(this.tmpPalmEdgeA, this.tmpPalmEdgeB);
    if (this.tmpPalmNormal.lengthSq() < 1e-8) {
      this.palmOccluderMesh.visible = false;
      return;
    }
    this.tmpPalmNormal.normalize();

    // Verify polygon winding relative to tmpPalmNormal using triangle (center -> v0 -> v1)
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
    this.palmOccluderGeo.computeBoundingSphere();
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
    deltaTimeSec = 1 / 60
  ): void {
    const renderer = this.renderer;
    if (!renderer || !this.ready) return;

    if (!frame || !design || frame.landmarks.length < HAND_LANDMARK_COUNT || frame.worldLandmarks.length < HAND_LANDMARK_COUNT) {
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

    let refPalmThicknessMeters = 0.022;

    // 5. Per-finger independent anatomical basis, metric dimensions, nail + skirt + occluders
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

      const spec = this.cachedFingerSpecs?.[fingerId];
      const activeShape: NailShape = spec?.shape ?? adjustment.shape;
      const tipRoundness = spec?.tipRoundness;

      // Cached per-finger volumetric geometry & conformal cuticle skirt
      const nailGeo = this.getOrCreateNailGeometry(activeShape, tipRoundness);
      if (rig.nailMesh.geometry !== nailGeo) {
        rig.nailMesh.geometry = nailGeo;
      }

      const skirtGeo = this.getOrCreateSkirtGeometry(activeShape);
      if (rig.cuticleSkirtMesh.geometry !== skirtGeo) {
        rig.cuticleSkirtMesh.geometry = skirtGeo;
      }

      applyDorsalMaterialOpacity(rig.dorsalMaterial, adjustment.opacity);
      rig.undersideBundle.material.opacity = clamp(adjustment.opacity, 0.7, 1.0);

      // Metric dimensions directly from filtered 3D worldLandmarks (in meters)
      const metrics = computeFingerMetricDimensions(fingerId, filtered.worldLandmarks);
      if (fingerId === 'middle') {
        refPalmThicknessMeters = metrics.palmThicknessMeters;
      }

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

      // Real nail length in meters without double multiplication:
      // bedLengthMeters covers v ∈ [0, 0.58] (cuticle lerp(DIP, TIP, 0.22) -> TIP)
      let totalLenMeters: number;
      if (spec?.extensionMm !== undefined && Number.isFinite(spec.extensionMm)) {
        const extMeters = clamp(spec.extensionMm, 0.5, 13.0) / 1000;
        totalLenMeters = (metrics.bedLengthMeters + extMeters) * fineExtMult;
      } else {
        const lenMult = clamp(
          spec?.lengthMultiplier ?? spec?.relativeLength ?? 1.15,
          0.92,
          1.65
        );
        totalLenMeters = metrics.bedLengthMeters * lenMult * fineExtMult;
      }
      totalLenMeters = Math.min(totalLenMeters, metrics.bedLengthMeters * 1.85);

      const nailWMeters =
        metrics.nailWidthMeters *
        clamp(spec?.relativeWidth ?? 1.0, 0.88, 1.18) *
        fineWidthMult;
      const nailDepthMeters = nailWMeters;

      // Dorsal cuticle anchor strictly attached to distal cylinder surface (zero profile gap)
      this.tmpCuticlePos.copy(dipPt).lerp(tipPt, 0.22);
      const dorsalOffset = metrics.phalanxRadiusMeters * 0.88;
      this.tmpNailPos
        .copy(this.tmpCuticlePos)
        .addScaledVector(this.tmpAxisZ, dorsalOffset);

      rig.nailMesh.position.copy(this.tmpNailPos);
      rig.nailMesh.quaternion.copy(this.tmpNailQuat);
      rig.nailMesh.scale.set(nailWMeters, totalLenMeters, nailDepthMeters);
      rig.nailMesh.visible = true;

      // Conformal Cuticle & Lateral Sulcus AO Contact Skirt aligned 1:1 with nail plate
      const dorsalDotView = -this.tmpAxisZ.z; // camera looks toward -Z, toward camera is +Z => +this.tmpAxisZ.z
      const skirtOpacity = clamp((this.tmpAxisZ.z + 0.05) / 0.25, 0, 1);
      if (skirtOpacity > 0.02 && adjustment.opacity > 0.2) {
        rig.cuticleSkirtMesh.position.copy(this.tmpNailPos);
        rig.cuticleSkirtMesh.quaternion.copy(this.tmpNailQuat);
        rig.cuticleSkirtMesh.scale.set(nailWMeters, totalLenMeters, nailDepthMeters);
        rig.cuticleSkirtMesh.visible = true;
      } else {
        rig.cuticleSkirtMesh.visible = false;
      }
      void dorsalDotView;

      // Volumetric Phalanx Cylinder + Joint Sphere Occluders (renderOrder = 1)
      const distalRadius = metrics.phalanxRadiusMeters;
      const middleRadius = distalRadius * 1.08;
      const proximalRadius = distalRadius * 1.16;

      this.positionCylinderSegment(rig.proximalRodMesh, mcpPt, pipPt, proximalRadius);
      this.positionCylinderSegment(rig.middleRodMesh, pipPt, dipPt, middleRadius);
      this.positionCylinderSegment(rig.distalRodMesh, dipPt, tipPt, distalRadius * 0.82);

      this.positionJointSphere(rig.mcpJointMesh, mcpPt, proximalRadius * 1.03);
      this.positionJointSphere(rig.pipJointMesh, pipPt, middleRadius * 1.02);
      this.positionJointSphere(rig.dipJointMesh, dipPt, distalRadius * 1.0);

      // Ventral Distal Pulp Sphere: centered at lerp(DIP, TIP, 0.82) shifted -0.12*distalRadius along -axisZ
      this.tmpPulpPos
        .copy(dipPt)
        .lerp(tipPt, 0.82)
        .addScaledVector(this.tmpAxisZ, -0.12 * distalRadius);
      this.positionJointSphere(rig.distalPulpMesh, this.tmpPulpPos, distalRadius * 0.96);
    }

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

    this.cachedPBRBundles.clear();
    this.skirtMaterialBundle.material.dispose();
    this.skirtMaterialBundle.texture.dispose();
    this.palmOccluderGeo.dispose();
    this.unitCylinderGeo.dispose();
    this.unitSphereGeo.dispose();
    this.occluderMaterial.dispose();
    this.envMap?.dispose();
    this.envMap = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.ready = false;
  }
}

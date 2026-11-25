import type { FingerPose, NailAdjustment, NailDesign, NailShape } from '../types/nail';
import type { ImageLayoutRect } from './nailRenderer';

export interface AmbientLightSample {
  /** Normalized skin/room tint RGB (0..1) */
  r: number;
  g: number;
  b: number;
  /** Normalized room luminance (0..1) */
  luma: number;
}

const VERT_SHADER_SRC = `
  attribute vec2 a_localPos;     // x in [-0.5, 0.5] shaped, y in [0, 1] cuticle->tip
  attribute vec2 a_uv;           // conformal UV texture coords (0..1)
  attribute vec3 a_normal;       // 3D cylindrical Arco-C surface normal
  attribute float a_sCoord;      // signed lateral coordinate [-1, 1] across width

  uniform vec2 u_resolution;     // canvas CSS resolution (px)
  uniform vec2 u_cuticlePx;      // cuticle anchor in px
  uniform vec2 u_nailSizePx;     // (widthPx, heightPx)
  uniform float u_angleRad;      // finger orientation angle

  varying vec2 v_uv;
  varying vec3 v_normal;
  varying float v_vCoord;
  varying float v_sCoord;

  void main() {
    float lx = a_localPos.x * u_nailSizePx.x;
    float ly = -a_localPos.y * u_nailSizePx.y;

    float c = cos(u_angleRad);
    float s = sin(u_angleRad);
    vec2 rotated = vec2(lx * c - ly * s, lx * s + ly * c);
    vec2 screenPx = u_cuticlePx + rotated;

    vec2 clip = (screenPx / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;

    gl_Position = vec4(clip, 0.0, 1.0);
    v_uv = a_uv;
    v_normal = a_normal;
    v_vCoord = a_localPos.y;
    v_sCoord = a_sCoord;
  }
`;

const FRAG_SHADER_SRC = `
  precision mediump float;

  uniform sampler2D u_tex;
  uniform vec2 u_texelSize;
  uniform float u_angleRad;
  uniform float u_opacity;
  uniform float u_glossStrength;
  uniform float u_bumpStrength;
  uniform float u_metallicBoost;
  uniform vec3 u_ambientRgb;
  uniform float u_ambientLuma;

  varying vec2 v_uv;
  varying vec3 v_normal;
  varying float v_vCoord;
  varying float v_sCoord;

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec4 texSample = texture2D(u_tex, v_uv);
    vec3 baseColor = texSample.rgb;

    // 1) Procedural Bump / Normal Map from real-time texture luminance gradient
    float hL = luma(texture2D(u_tex, v_uv - vec2(u_texelSize.x, 0.0)).rgb);
    float hR = luma(texture2D(u_tex, v_uv + vec2(u_texelSize.x, 0.0)).rgb);
    float hD = luma(texture2D(u_tex, v_uv - vec2(0.0, u_texelSize.y)).rgb);
    float hU = luma(texture2D(u_tex, v_uv + vec2(0.0, u_texelSize.y)).rgb);
    float gx = (hR - hL) * u_bumpStrength;
    float gy = (hU - hD) * u_bumpStrength;

    vec3 cylN = normalize(v_normal);
    vec3 N = normalize(vec3(cylN.x - gx, cylN.y - gy, max(0.22, cylN.z)));

    // 2) Dynamic studio softbox light gliding with finger inclination
    float tilt = clamp(sin(u_angleRad), -1.0, 1.0);
    vec3 L1 = normalize(vec3(-0.34 + tilt * 0.52, 0.36 + cos(u_angleRad) * 0.14, 0.88));
    vec3 L2 = normalize(vec3(0.58 - tilt * 0.35, -0.25, 0.72));
    vec3 V  = vec3(0.0, 0.0, 1.0);
    vec3 H1 = normalize(L1 + V);
    vec3 H2 = normalize(L2 + V);

    // 3) Ambient Light Matching (exposure & color temperature from live finger skin)
    float exposure = clamp(0.74 + u_ambientLuma * 0.54, 0.68, 1.18);
    vec3 normTint = u_ambientRgb / max(0.08, max(u_ambientRgb.r, max(u_ambientRgb.g, u_ambientRgb.b)));
    vec3 roomTemp = mix(vec3(1.0), mix(vec3(1.0), normTint, 0.55), 0.28);

    // 4) Cylindrical Arco-C diffuse + lateral Ambient Occlusion (AO)
    float diff = clamp(dot(N, L1), 0.0, 1.0);
    float sideEdge = abs(v_sCoord);
    float lateralAO = 1.0 - smoothstep(0.58, 1.0, sideEdge) * 0.36;
    float proximalAO = 1.0 - (1.0 - smoothstep(0.0, 0.20, v_vCoord)) * 0.26;
    vec3 shadowTint = mix(vec3(0.22, 0.12, 0.13), u_ambientRgb * 0.45, 0.5);

    vec3 lit = baseColor * exposure * roomTemp * (0.64 + 0.42 * diff);
    lit = mix(lit * shadowTint * 1.45, lit, lateralAO * proximalAO);

    // 5) Metallic / 3D decoration relief detection (gold wires, chrome, pearl accents)
    float maxC = max(baseColor.r, max(baseColor.g, baseColor.b));
    float minC = min(baseColor.r, min(baseColor.g, baseColor.b));
    float reliefEdge = clamp(length(vec2(hR - hL, hU - hD)) * 6.5, 0.0, 1.0);
    float warmGold = clamp((baseColor.r - baseColor.b) * 1.8 * smoothstep(0.35, 0.85, maxC), 0.0, 1.0);
    float metallicMask = clamp(reliefEdge * 0.75 + warmGold * 0.45 + u_metallicBoost, 0.0, 1.0);

    // Broad curved gel topcoat gloss + crisp metallic/3D relief specular
    float gelSpec = pow(max(dot(cylN, H1), 0.0), 34.0) * (0.46 * u_glossStrength);
    float crispSpec = pow(max(dot(N, H1), 0.0), 96.0) * (0.58 * u_glossStrength * (0.55 + metallicMask * 0.95));
    float bounceRim = pow(max(dot(cylN, H2), 0.0), 22.0) * (0.18 * u_glossStrength);
    float fresnel = pow(1.0 - max(dot(cylN, V), 0.0), 3.0) * 0.20 * u_glossStrength;

    vec3 specColor = mix(vec3(1.0, 0.985, 0.97), baseColor * 0.45 + vec3(0.65), metallicMask * 0.55);
    vec3 finalColor = lit + specColor * (gelSpec + crispSpec + bounceRim) + vec3(1.0, 0.96, 0.94) * fresnel;

    // 6) Subsurface Cuticle Feathering (melts base into skin with zero sticker line)
    float cuticleAlpha = smoothstep(0.0, 0.16, v_vCoord);
    vec3 subsurfaceSkin = mix(u_ambientRgb * 0.92, finalColor, smoothstep(0.0, 0.24, v_vCoord));
    finalColor = mix(subsurfaceSkin, finalColor, smoothstep(0.02, 0.22, v_vCoord));

    // Subtle anti-aliased lateral feather along outer edge (prevents hard pixelated rim)
    float edgeAA = 1.0 - smoothstep(0.92, 1.0, sideEdge);
    float tipAA = 1.0 - smoothstep(0.965, 1.0, v_vCoord);

    float alpha = clamp(cuticleAlpha * edgeAA * tipAA * u_opacity, 0.0, 1.0);
    gl_FragColor = vec4(finalColor * alpha, alpha);
  }
`;

const SHAPE_LENGTH_MULT: Record<NailShape, number> = {
  natural: 0.9,
  square: 1.02,
  almond: 1.1,
  coffin: 1.18,
  stiletto: 1.26,
};

/**
 * Computes half-width profile (0..0.52) along v ∈ [0, 1] (0 = cuticle, 1 = tip)
 * for all 5 realistic salon silhouettes.
 */
function evalShapeHalfWidth(v: number, shape: NailShape): number {
  // Proximal cuticle arch (v = 0..0.18) smoothly widens from 0.20 -> 0.50
  const cuticleCurve = v < 0.18 ? 0.22 + 0.28 * Math.sin((v / 0.18) * (Math.PI / 2)) : 0.5;

  if (shape === 'natural') {
    if (v > 0.68) {
      const t = (v - 0.68) / 0.32;
      return 0.5 * Math.sqrt(Math.max(0.02, 1 - t * t));
    }
    return cuticleCurve;
  }

  if (shape === 'square') {
    if (v > 0.92) {
      const t = (v - 0.92) / 0.08;
      return 0.48 * (1 - 0.14 * t * t);
    }
    return Math.min(0.49, cuticleCurve * 0.98);
  }

  if (shape === 'coffin') {
    if (v > 0.34) {
      const t = (v - 0.34) / 0.66;
      const base = 0.5 * (1 - 0.46 * Math.pow(t, 1.18));
      return v > 0.96 ? base * (1 - ((v - 0.96) / 0.04) * 0.12) : base;
    }
    return cuticleCurve;
  }

  if (shape === 'stiletto') {
    if (v > 0.28) {
      const t = (v - 0.28) / 0.72;
      return Math.max(0.022, 0.5 * Math.pow(1 - t, 1.15));
    }
    return cuticleCurve;
  }

  // Almond (default)
  if (v > 0.38) {
    const t = (v - 0.38) / 0.62;
    return Math.max(0.03, 0.5 * Math.pow(Math.cos(t * (Math.PI / 2)), 0.78));
  }
  return cuticleCurve;
}

interface MeshBuffers {
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  indexCount: number;
}

/**
 * Generates a subdivided 3D curved Arco-C mesh with conformal distortion-free UV mapping
 * for a given nail shape.
 */
function buildNailMeshData(shape: NailShape, cols = 20, rows = 26): {
  vertices: Float32Array;
  indices: Uint16Array;
} {
  // 8 floats per vertex: localX, localY, uTex, vTex, nx, ny, nz, sCoord
  const stride = 8;
  const vertices = new Float32Array((cols + 1) * (rows + 1) * stride);

  let ptr = 0;
  for (let r = 0; r <= rows; r++) {
    const v = r / rows; // 0 = cuticle, 1 = free edge tip
    const halfW = evalShapeHalfWidth(v, shape);

    for (let c = 0; c <= cols; c++) {
      const s = (c / cols) * 2 - 1; // -1 (left sidewall) .. +1 (right sidewall)
      const localX = s * halfW;
      const localY = v;

      // Conformal UV mapping: preserves artwork aspect ratio near tapered tips without squashing!
      const uTex = 0.5 + localX * 0.96;
      const vTex = 1.0 - v; // image top = nail tip, image bottom = cuticle

      // True 3D cylindrical Arco-C normal across width + gentle longitudinal apex curvature
      const theta = s * Math.PI * 0.46;
      const nx = Math.sin(theta);
      const ny = -Math.cos(v * Math.PI) * 0.22;
      const nz = Math.cos(theta);
      const nLen = Math.hypot(nx, ny, nz) || 1;

      vertices[ptr++] = localX;
      vertices[ptr++] = localY;
      vertices[ptr++] = uTex;
      vertices[ptr++] = vTex;
      vertices[ptr++] = nx / nLen;
      vertices[ptr++] = ny / nLen;
      vertices[ptr++] = nz / nLen;
      vertices[ptr++] = s;
    }
  }

  const indices = new Uint16Array(cols * rows * 6);
  let iPtr = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = r * (cols + 1) + c;
      const tr = tl + 1;
      const bl = (r + 1) * (cols + 1) + c;
      const br = bl + 1;
      indices[iPtr++] = tl;
      indices[iPtr++] = bl;
      indices[iPtr++] = tr;
      indices[iPtr++] = tr;
      indices[iPtr++] = bl;
      indices[iPtr++] = br;
    }
  }

  return { vertices, indices };
}

/**
 * Generates a high-res procedural canvas texture for studio catalog designs so
 * BOTH studio presets and customer-extracted photos run through the identical WebGL 3D shader.
 */
function buildProceduralTextureCanvas(design: NailDesign): HTMLCanvasElement {
  const w = 256;
  const h = 384;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  const base = design.baseColor || '#E8C5BA';
  const secondary = design.secondaryColor || '#FFFFFF';
  const accent = design.accentColor || '#D4AF37';

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, base);
  bg.addColorStop(1, base);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  switch (design.patternType) {
    case 'french': {
      const isMicro = design.name.toLowerCase().includes('micro');
      const tipY = isMicro ? h * 0.22 : h * 0.30;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, tipY + h * 0.08);
      ctx.quadraticCurveTo(w / 2, tipY - h * 0.14, 0, tipY + h * 0.08);
      ctx.closePath();
      ctx.fillStyle = secondary;
      ctx.fill();

      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, tipY + h * 0.08);
      ctx.quadraticCurveTo(w / 2, tipY - h * 0.14, w, tipY + h * 0.08);
      ctx.stroke();
      break;
    }
    case 'ombre': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, secondary);
      g.addColorStop(0.42, base);
      g.addColorStop(1, base);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'chrome': {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, base);
      g.addColorStop(0.35, secondary);
      g.addColorStop(0.55, '#FFFFFF');
      g.addColorStop(0.8, accent);
      g.addColorStop(1, base);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'marble': {
      ctx.strokeStyle = secondary;
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(20, 48);
      ctx.bezierCurveTo(110, 120, 160, 210, 230, 320);
      ctx.stroke();

      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(220, 60);
      ctx.bezierCurveTo(140, 150, 90, 230, 40, 340);
      ctx.stroke();

      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(85, 70);
      ctx.quadraticCurveTo(150, 180, 190, 300);
      ctx.stroke();
      break;
    }
    case 'gold-foil': {
      const flakes = [
        [0.28, 0.28, 56, 36, 0.4],
        [0.68, 0.48, 64, 34, -0.5],
        [0.36, 0.68, 52, 32, 0.25],
        [0.54, 0.16, 40, 24, -0.2],
      ];
      for (const [fx, fy, fw, fh, rot] of flakes) {
        ctx.save();
        ctx.translate(fx * w, fy * h);
        ctx.rotate(rot);
        const fg = ctx.createLinearGradient(-fw / 2, -fh / 2, fw / 2, fh / 2);
        fg.addColorStop(0, '#FFF1B8');
        fg.addColorStop(0.5, accent);
        fg.addColorStop(1, '#9E7818');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(-fw * 0.5, -fh * 0.3);
        ctx.lineTo(fw * 0.2, -fh * 0.5);
        ctx.lineTo(fw * 0.5, fh * 0.35);
        ctx.lineTo(-fw * 0.25, fh * 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'cat-eye': {
      const rg = ctx.createRadialGradient(w * 0.44, h * 0.44, 12, w * 0.5, h * 0.5, h * 0.65);
      rg.addColorStop(0, '#FFF6E0');
      rg.addColorStop(0.24, accent);
      rg.addColorStop(0.62, base);
      rg.addColorStop(1, '#3B2A1E');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'aurora': {
      const ag = ctx.createLinearGradient(0, 0, w, h);
      ag.addColorStop(0, base);
      ag.addColorStop(0.38, secondary);
      ag.addColorStop(0.72, accent);
      ag.addColorStop(1, '#E6D6F5');
      ctx.fillStyle = ag;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    default:
      break;
  }

  return c;
}

export class WebGLNailEngine {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private meshes = new Map<NailShape, MeshBuffers>();
  private textures = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  private pendingImageUrls = new Set<string>();

  private locs: {
    a_localPos: number;
    a_uv: number;
    a_normal: number;
    a_sCoord: number;
    u_resolution: WebGLUniformLocation | null;
    u_cuticlePx: WebGLUniformLocation | null;
    u_nailSizePx: WebGLUniformLocation | null;
    u_angleRad: WebGLUniformLocation | null;
    u_tex: WebGLUniformLocation | null;
    u_texelSize: WebGLUniformLocation | null;
    u_opacity: WebGLUniformLocation | null;
    u_glossStrength: WebGLUniformLocation | null;
    u_bumpStrength: WebGLUniformLocation | null;
    u_metallicBoost: WebGLUniformLocation | null;
    u_ambientRgb: WebGLUniformLocation | null;
    u_ambientLuma: WebGLUniformLocation | null;
  } | null = null;

  public constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) return;

    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER_SRC);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER_SRC);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return;
    }

    this.gl = gl;
    this.program = prog;
    this.locs = {
      a_localPos: gl.getAttribLocation(prog, 'a_localPos'),
      a_uv: gl.getAttribLocation(prog, 'a_uv'),
      a_normal: gl.getAttribLocation(prog, 'a_normal'),
      a_sCoord: gl.getAttribLocation(prog, 'a_sCoord'),
      u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
      u_cuticlePx: gl.getUniformLocation(prog, 'u_cuticlePx'),
      u_nailSizePx: gl.getUniformLocation(prog, 'u_nailSizePx'),
      u_angleRad: gl.getUniformLocation(prog, 'u_angleRad'),
      u_tex: gl.getUniformLocation(prog, 'u_tex'),
      u_texelSize: gl.getUniformLocation(prog, 'u_texelSize'),
      u_opacity: gl.getUniformLocation(prog, 'u_opacity'),
      u_glossStrength: gl.getUniformLocation(prog, 'u_glossStrength'),
      u_bumpStrength: gl.getUniformLocation(prog, 'u_bumpStrength'),
      u_metallicBoost: gl.getUniformLocation(prog, 'u_metallicBoost'),
      u_ambientRgb: gl.getUniformLocation(prog, 'u_ambientRgb'),
      u_ambientLuma: gl.getUniformLocation(prog, 'u_ambientLuma'),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  public isReady(): boolean {
    return Boolean(this.gl && this.program && this.locs);
  }

  private compileShader(
    gl: WebGLRenderingContext,
    type: number,
    src: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private getOrBuildMesh(shape: NailShape): MeshBuffers | null {
    const gl = this.gl;
    if (!gl) return null;
    const existing = this.meshes.get(shape);
    if (existing) return existing;

    const { vertices, indices } = buildNailMeshData(shape);
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (!vbo || !ibo) return null;

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const mesh: MeshBuffers = { vbo, ibo, indexCount: indices.length };
    this.meshes.set(shape, mesh);
    return mesh;
  }

  private uploadTexture(key: string, source: HTMLImageElement | HTMLCanvasElement): void {
    const gl = this.gl;
    if (!gl) return;
    const prev = this.textures.get(key);
    if (prev) gl.deleteTexture(prev.tex);

    const tex = gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    this.textures.set(key, { tex, w: Math.max(1, w), h: Math.max(1, h) });
  }

  private getTextureForDesign(design: NailDesign): { tex: WebGLTexture; w: number; h: number } | null {
    if (design.imageDataUrl) {
      const key = `img:${design.id}:${design.imageDataUrl.slice(-24)}`;
      const cached = this.textures.get(key);
      if (cached) return cached;

      if (!this.pendingImageUrls.has(key)) {
        this.pendingImageUrls.add(key);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.uploadTexture(key, img);
          this.pendingImageUrls.delete(key);
        };
        img.onerror = () => {
          this.pendingImageUrls.delete(key);
        };
        img.src = design.imageDataUrl;
      }
      return null;
    }

    const procKey = `proc:${design.id}:${design.baseColor}:${design.patternType}`;
    const existing = this.textures.get(procKey);
    if (existing) return existing;

    const canvasTex = buildProceduralTextureCanvas(design);
    this.uploadTexture(procKey, canvasTex);
    return this.textures.get(procKey) ?? null;
  }

  public clear(cssW: number, cssH: number, dpr: number): void {
    const gl = this.gl;
    if (!gl) return;
    const targetW = Math.max(1, Math.round(cssW * dpr));
    const targetH = Math.max(1, Math.round(cssH * dpr));
    if (gl.canvas.width !== targetW || gl.canvas.height !== targetH) {
      gl.canvas.width = targetW;
      gl.canvas.height = targetH;
    }
    gl.viewport(0, 0, targetW, targetH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
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
    const gl = this.gl;
    const program = this.program;
    const locs = this.locs;
    if (!gl || !program || !locs) return;

    this.clear(cssW, cssH, dpr);
    if (poses.length === 0) return;

    const texObj = this.getTextureForDesign(design);
    const mesh = this.getOrBuildMesh(adjustment.shape);
    if (!texObj || !mesh) return;

    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);

    const strideBytes = 8 * 4;
    gl.enableVertexAttribArray(locs.a_localPos);
    gl.vertexAttribPointer(locs.a_localPos, 2, gl.FLOAT, false, strideBytes, 0);
    gl.enableVertexAttribArray(locs.a_uv);
    gl.vertexAttribPointer(locs.a_uv, 2, gl.FLOAT, false, strideBytes, 2 * 4);
    gl.enableVertexAttribArray(locs.a_normal);
    gl.vertexAttribPointer(locs.a_normal, 3, gl.FLOAT, false, strideBytes, 4 * 4);
    gl.enableVertexAttribArray(locs.a_sCoord);
    gl.vertexAttribPointer(locs.a_sCoord, 1, gl.FLOAT, false, strideBytes, 7 * 4);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
    gl.uniform1i(locs.u_tex, 0);
    gl.uniform2f(locs.u_texelSize, 1.5 / texObj.w, 1.5 / texObj.h);
    gl.uniform2f(locs.u_resolution, cssW, cssH);

    const glossStrength =
      design.finish === 'velvet'
        ? 0.45
        : design.finish === 'chrome'
          ? 1.35
          : design.finish === 'glitter'
            ? 1.15
            : 1.05;
    const bumpStrength = design.imageDataUrl ? 2.4 : design.patternType === 'gold-foil' ? 2.8 : 1.1;
    const metallicBoost =
      design.finish === 'chrome'
        ? 0.45
        : design.finish === 'glitter' || design.patternType === 'gold-foil'
          ? 0.35
          : 0.08;

    gl.uniform1f(locs.u_opacity, adjustment.opacity);
    gl.uniform1f(locs.u_glossStrength, glossStrength);
    gl.uniform1f(locs.u_bumpStrength, bumpStrength);
    gl.uniform1f(locs.u_metallicBoost, metallicBoost);
    gl.uniform3f(locs.u_ambientRgb, ambient.r, ambient.g, ambient.b);
    gl.uniform1f(locs.u_ambientLuma, ambient.luma);

    const shapeMult = SHAPE_LENGTH_MULT[adjustment.shape] ?? 1.0;

    for (const pose of poses) {
      const tipX = rect.drawX + (mirrorX ? 1 - pose.tip.x : pose.tip.x) * rect.drawW;
      const tipY = rect.drawY + pose.tip.y * rect.drawH;
      const dipX = rect.drawX + (mirrorX ? 1 - pose.dip.x : pose.dip.x) * rect.drawW;
      const dipY = rect.drawY + pose.dip.y * rect.drawH;

      const dx = tipX - dipX;
      const dy = tipY - dipY;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 4) continue;

      const angle = Math.atan2(dy, dx) + Math.PI / 2 + (adjustment.rotationDeg * Math.PI) / 180;

      // Anchor cuticle slightly below DIP->TIP midpoint so full natural nail bed is covered
      const cuticleT = pose.id === 'thumb' ? 0.44 : 0.38;
      const cuticleX = dipX + dx * cuticleT;
      const cuticleY = dipY + dy * cuticleT;

      // 1.12x anatomical width coverage prevents any natural nail edge leaking underneath
      const nailW = pose.widthScale * rect.drawW * 1.12 * adjustment.scale;
      const baseH = Math.max(pose.lengthScale * rect.drawH, segLen * 0.92);
      const nailH = baseH * adjustment.scale * adjustment.extensionLength * shapeMult;

      gl.uniform2f(locs.u_cuticlePx, cuticleX, cuticleY);
      gl.uniform2f(locs.u_nailSizePx, nailW, nailH);
      gl.uniform1f(locs.u_angleRad, angle);

      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  public dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    for (const m of this.meshes.values()) {
      gl.deleteBuffer(m.vbo);
      gl.deleteBuffer(m.ibo);
    }
    for (const t of this.textures.values()) {
      gl.deleteTexture(t.tex);
    }
    if (this.program) gl.deleteProgram(this.program);
    this.meshes.clear();
    this.textures.clear();
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

  // Prefer middle or index finger skin between PIP and DIP
  const refPose =
    poses.find((p) => p.id === 'middle') ?? poses.find((p) => p.id === 'index') ?? poses[0];

  const skinNormX = refPose.pip
    ? (refPose.dip.x + refPose.pip.x) * 0.5
    : refPose.dip.x;
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

    // Smooth temporal EMA so ambient exposure never flickers
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

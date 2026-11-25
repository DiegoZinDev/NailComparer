import type { FingerPose, NailAdjustment, NailDesign, NailShape } from '../types/nail';

// Exact calibrated poses on /hand-demo.png (896x1200 portrait)
export const DEMO_HAND_POSES: FingerPose[] = [
  {
    id: 'thumb',
    tip: { x: 0.142, y: 0.456 },
    dip: { x: 0.195, y: 0.528 },
    widthScale: 0.052,
    lengthScale: 0.072,
  },
  {
    id: 'index',
    tip: { x: 0.335, y: 0.188 },
    dip: { x: 0.337, y: 0.275 },
    widthScale: 0.052,
    lengthScale: 0.078,
  },
  {
    id: 'middle',
    tip: { x: 0.494, y: 0.148 },
    dip: { x: 0.494, y: 0.238 },
    widthScale: 0.054,
    lengthScale: 0.080,
  },
  {
    id: 'ring',
    tip: { x: 0.642, y: 0.210 },
    dip: { x: 0.637, y: 0.296 },
    widthScale: 0.051,
    lengthScale: 0.076,
  },
  {
    id: 'pinky',
    tip: { x: 0.802, y: 0.348 },
    dip: { x: 0.778, y: 0.425 },
    widthScale: 0.043,
    lengthScale: 0.066,
  },
];

// Anatomical finger landmark indices & per-finger width/length calibration (21 points)
export const MEDIAPIPE_FINGER_PAIRS: Array<{
  id: FingerPose['id'];
  tipIdx: number;
  dipIdx: number;
  pipIdx: number;
  widthFactor: number;
  lengthFactor: number;
}> = [
  { id: 'thumb', tipIdx: 4, dipIdx: 3, pipIdx: 2, widthFactor: 0.55, lengthFactor: 0.84 },
  { id: 'index', tipIdx: 8, dipIdx: 7, pipIdx: 6, widthFactor: 0.48, lengthFactor: 0.88 },
  { id: 'middle', tipIdx: 12, dipIdx: 11, pipIdx: 10, widthFactor: 0.50, lengthFactor: 0.90 },
  { id: 'ring', tipIdx: 16, dipIdx: 15, pipIdx: 14, widthFactor: 0.47, lengthFactor: 0.88 },
  { id: 'pinky', tipIdx: 20, dipIdx: 19, pipIdx: 18, widthFactor: 0.42, lengthFactor: 0.82 },
];

const SHAPE_LENGTH_FACTOR: Record<NailShape, number> = {
  natural: 0.88,
  oval: 0.96,
  square: 1.0,
  almond: 1.08,
  coffin: 1.16,
  stiletto: 1.24,
};

export interface ImageLayoutRect {
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
}

/**
 * Computes CSS object-fit: cover layout rectangle for any media inside canvas.
 */
export function computeCoverRect(
  canvasW: number,
  canvasH: number,
  mediaW: number,
  mediaH: number
): ImageLayoutRect {
  if (!mediaW || !mediaH) {
    return { drawX: 0, drawY: 0, drawW: canvasW, drawH: canvasH };
  }
  const canvasRatio = canvasW / canvasH;
  const mediaRatio = mediaW / mediaH;

  if (mediaRatio > canvasRatio) {
    const drawH = canvasH;
    const drawW = canvasH * mediaRatio;
    return {
      drawX: (canvasW - drawW) / 2,
      drawY: 0,
      drawW,
      drawH,
    };
  }
  const drawW = canvasW;
  const drawH = canvasW / mediaRatio;
  return {
    drawX: 0,
    drawY: (canvasH - drawH) / 2,
    drawW,
    drawH,
  };
}

/**
 * Traces an anatomical nail silhouette anchored at the cuticle base y = 0,
 * growing upward along -Y to the free edge at y = -h.
 */
function traceCuticleAnchoredNailPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  shape: NailShape
): void {
  const hw = w / 2;

  ctx.beginPath();
  if (shape === 'natural') {
    // Organic natural nail: soft rounded cuticle + gentle curved free edge
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(hw * 0.72, 0, hw * 0.96, -h * 0.14, hw * 0.95, -h * 0.56);
    ctx.bezierCurveTo(hw * 0.94, -h * 0.86, hw * 0.62, -h, 0, -h);
    ctx.bezierCurveTo(-hw * 0.62, -h, -hw * 0.94, -h * 0.86, -hw * 0.95, -h * 0.56);
    ctx.bezierCurveTo(-hw * 0.96, -h * 0.14, -hw * 0.72, 0, 0, 0);
  } else if (shape === 'oval') {
    // Classic rounded oval silhouette
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(hw * 0.72, 0, hw * 0.97, -h * 0.14, hw * 0.96, -h * 0.50);
    ctx.bezierCurveTo(hw * 0.95, -h * 0.82, hw * 0.54, -h * 1.0, 0, -h * 1.0);
    ctx.bezierCurveTo(-hw * 0.54, -h * 1.0, -hw * 0.95, -h * 0.82, -hw * 0.96, -h * 0.50);
    ctx.bezierCurveTo(-hw * 0.97, -h * 0.14, -hw * 0.72, 0, 0, 0);
  } else if (shape === 'square') {
    // Crisp salon square extension with softly beveled corners
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(hw * 0.72, 0, hw * 0.97, -h * 0.13, hw * 0.98, -h * 0.45);
    ctx.lineTo(hw * 0.95, -h * 0.92);
    ctx.quadraticCurveTo(hw * 0.94, -h, hw * 0.74, -h);
    ctx.lineTo(-hw * 0.74, -h);
    ctx.quadraticCurveTo(-hw * 0.94, -h, -hw * 0.95, -h * 0.92);
    ctx.lineTo(-hw * 0.98, -h * 0.45);
    ctx.bezierCurveTo(-hw * 0.97, -h * 0.13, -hw * 0.72, 0, 0, 0);
  } else if (shape === 'coffin') {
    // Sculpted ballerina / coffin taper with flat refined apex tip
    const tipHw = hw * 0.52;
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(hw * 0.72, 0, hw * 0.98, -h * 0.13, hw * 0.96, -h * 0.36);
    ctx.bezierCurveTo(hw * 0.92, -h * 0.62, hw * 0.72, -h * 0.84, tipHw, -h * 0.98);
    ctx.quadraticCurveTo(0, -h * 1.01, -tipHw, -h * 0.98);
    ctx.bezierCurveTo(-hw * 0.72, -h * 0.84, -hw * 0.92, -h * 0.62, -hw * 0.96, -h * 0.36);
    ctx.bezierCurveTo(-hw * 0.98, -h * 0.13, -hw * 0.72, 0, 0, 0);
  } else if (shape === 'stiletto') {
    // Dramatic luxury stiletto point with micro-rounded tip
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(hw * 0.72, 0, hw * 0.98, -h * 0.13, hw * 0.94, -h * 0.34);
    ctx.bezierCurveTo(hw * 0.86, -h * 0.66, hw * 0.42, -h * 0.90, hw * 0.10, -h * 0.99);
    ctx.quadraticCurveTo(0, -h * 1.03, -hw * 0.10, -h * 0.99);
    ctx.bezierCurveTo(-hw * 0.42, -h * 0.90, -hw * 0.86, -h * 0.66, -hw * 0.94, -h * 0.34);
    ctx.bezierCurveTo(-hw * 0.98, -h * 0.13, -hw * 0.72, 0, 0, 0);
  } else {
    // Almond luxury silhouette (default)
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(hw * 0.72, 0, hw * 0.98, -h * 0.13, hw * 0.96, -h * 0.40);
    ctx.bezierCurveTo(hw * 0.94, -h * 0.74, hw * 0.56, -h * 0.98, 0, -h * 1.02);
    ctx.bezierCurveTo(-hw * 0.56, -h * 0.98, -hw * 0.94, -h * 0.74, -hw * 0.96, -h * 0.40);
    ctx.bezierCurveTo(-hw * 0.98, -h * 0.13, -hw * 0.72, 0, 0, 0);
  }
  ctx.closePath();
}

const imageCache = new Map<string, HTMLImageElement>();

function getCachedImage(src: string): HTMLImageElement | null {
  if (!src) return null;
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

// Reusable offscreen buffer for per-nail skin-melt cuticle feathering at 60fps
let nailBuffer: HTMLCanvasElement | null = null;
function getNailBuffer(minW: number, minH: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (!nailBuffer) {
    nailBuffer = document.createElement('canvas');
  }
  const targetW = Math.max(64, Math.ceil(minW));
  const targetH = Math.max(64, Math.ceil(minH));
  if (nailBuffer.width < targetW || nailBuffer.height < targetH) {
    nailBuffer.width = Math.max(nailBuffer.width, targetW);
    nailBuffer.height = Math.max(nailBuffer.height, targetH);
  }
  const bCtx = nailBuffer.getContext('2d');
  if (!bCtx) return null;
  bCtx.clearRect(0, 0, targetW, targetH);
  return { canvas: nailBuffer, ctx: bCtx };
}

/**
 * Draws procedural gel polish & nail art within local coords x ∈ [-hw, hw], y ∈ [-h, 0].
 */
function drawProceduralPattern(
  ctx: CanvasRenderingContext2D,
  design: NailDesign,
  w: number,
  h: number
): void {
  const hw = w / 2;
  const base = design.baseColor || '#E8C5BA';
  const secondary = design.secondaryColor || '#FFFFFF';
  const accent = design.accentColor || '#D4AF37';

  // Soft translucent gel bed base with subtle longitudinal depth
  const bedGrad = ctx.createLinearGradient(0, -h, 0, 0);
  bedGrad.addColorStop(0, shadeHex(base, 8));
  bedGrad.addColorStop(0.62, base);
  bedGrad.addColorStop(1, shadeHex(base, -10));
  ctx.fillStyle = bedGrad;
  ctx.fillRect(-hw * 1.2, -h * 1.15, w * 1.2, h * 1.25);

  switch (design.patternType) {
    case 'french': {
      const isMicro = design.name.toLowerCase().includes('micro');
      const tipY = isMicro ? -h * 0.78 : -h * 0.68;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-hw * 1.15, -h * 1.15);
      ctx.lineTo(hw * 1.15, -h * 1.15);
      ctx.lineTo(hw * 1.15, tipY + h * 0.08);
      ctx.quadraticCurveTo(0, tipY - h * 0.14, -hw * 1.15, tipY + h * 0.08);
      ctx.closePath();

      const tipGrad = ctx.createLinearGradient(-hw, -h, hw, tipY);
      tipGrad.addColorStop(0, shadeHex(secondary, -6));
      tipGrad.addColorStop(0.5, secondary);
      tipGrad.addColorStop(1, shadeHex(secondary, -8));
      ctx.fillStyle = tipGrad;
      ctx.fill();

      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(0.9, w * 0.026);
      ctx.beginPath();
      ctx.moveTo(-hw * 1.05, tipY + h * 0.075);
      ctx.quadraticCurveTo(0, tipY - h * 0.135, hw * 1.05, tipY + h * 0.075);
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'ombre': {
      const ombreGrad = ctx.createLinearGradient(0, -h * 0.98, 0, -h * 0.04);
      ombreGrad.addColorStop(0, secondary);
      ombreGrad.addColorStop(0.35, mixHex(secondary, base, 0.45));
      ombreGrad.addColorStop(0.75, base);
      ombreGrad.addColorStop(1, shadeHex(base, -10));
      ctx.fillStyle = ombreGrad;
      ctx.fillRect(-hw * 1.2, -h * 1.15, w * 1.2, h * 1.25);
      break;
    }

    case 'chrome': {
      const mirror = ctx.createLinearGradient(-hw, -h, hw, 0);
      mirror.addColorStop(0, shadeHex(base, -14));
      mirror.addColorStop(0.28, secondary);
      mirror.addColorStop(0.52, accent);
      mirror.addColorStop(0.76, '#FFFFFF');
      mirror.addColorStop(1, shadeHex(base, -18));
      ctx.fillStyle = mirror;
      ctx.fillRect(-hw * 1.2, -h * 1.15, w * 1.2, h * 1.25);

      const halo = ctx.createRadialGradient(-hw * 0.18, -h * 0.62, w * 0.04, 0, -h * 0.5, h * 0.72);
      halo.addColorStop(0, 'rgba(255,255,255,0.62)');
      halo.addColorStop(0.5, 'rgba(248, 224, 214, 0.18)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-hw * 1.2, -h * 1.15, w * 1.2, h * 1.25);
      break;
    }

    case 'marble': {
      const milky = ctx.createRadialGradient(0, -h * 0.55, w * 0.08, 0, -h * 0.5, h * 0.85);
      milky.addColorStop(0, 'rgba(255,255,255,0.38)');
      milky.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = milky;
      ctx.fillRect(-hw * 1.2, -h * 1.15, w * 1.2, h * 1.25);

      ctx.save();
      ctx.strokeStyle = secondary;
      ctx.globalAlpha = 0.58;
      ctx.lineWidth = Math.max(1, w * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-hw * 0.82, -h * 0.78);
      ctx.bezierCurveTo(-hw * 0.1, -h * 0.58, hw * 0.28, -h * 0.36, hw * 0.74, -h * 0.15);
      ctx.stroke();

      ctx.lineWidth = Math.max(0.8, w * 0.028);
      ctx.beginPath();
      ctx.moveTo(hw * 0.5, -h * 0.85);
      ctx.bezierCurveTo(hw * 0.05, -h * 0.52, -hw * 0.38, -h * 0.35, -hw * 0.62, -h * 0.1);
      ctx.stroke();

      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(0.7, w * 0.022);
      ctx.beginPath();
      ctx.moveTo(-hw * 0.28, -h * 0.72);
      ctx.quadraticCurveTo(hw * 0.18, -h * 0.48, hw * 0.42, -h * 0.22);
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'gold-foil': {
      ctx.save();
      const flakes = [
        [-0.22, -0.68, 0.24, 0.14, 0.4],
        [0.18, -0.48, 0.28, 0.13, -0.5],
        [-0.10, -0.28, 0.20, 0.12, 0.2],
        [0.06, -0.82, 0.15, 0.09, -0.2],
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
        const foilGrad = ctx.createLinearGradient(-fw * w, -fh * h, fw * w, fh * h);
        foilGrad.addColorStop(0, accent);
        foilGrad.addColorStop(0.5, secondary);
        foilGrad.addColorStop(1, '#9E7B1E');
        ctx.fillStyle = foilGrad;
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      break;
    }

    case 'cat-eye': {
      const beam = ctx.createRadialGradient(
        -hw * 0.08,
        -h * 0.58,
        w * 0.02,
        0,
        -h * 0.5,
        h * 0.65
      );
      beam.addColorStop(0, accent);
      beam.addColorStop(0.28, secondary);
      beam.addColorStop(0.68, base);
      beam.addColorStop(1, shadeHex(base, -28));
      ctx.fillStyle = beam;
      ctx.fillRect(-hw * 1.2, -h * 1.15, w * 1.2, h * 1.25);
      break;
    }

    case 'aurora': {
      const aura = ctx.createLinearGradient(-hw, -h, hw, 0);
      aura.addColorStop(0, base);
      aura.addColorStop(0.35, secondary);
      aura.addColorStop(0.7, accent);
      aura.addColorStop(1, '#E6D6F5');
      ctx.fillStyle = aura;
      ctx.fillRect(-hw * 1.2, -h * 1.15, w * 1.2, h * 1.25);
      break;
    }

    case 'solid':
    default:
      break;
  }
}

/**
 * Photorealistic layered gel/extension rendering:
 * 1) Sub-nail ambient contact shadow on skin
 * 2) Offscreen composite: silhouette clip -> extracted texture / procedural gel ->
 *    3D cylindrical lateral inner occlusion -> proximal cuticle depth ->
 *    angle-responsive gel specular gloss + micro-rim reflection ->
 *    soft skin-melt alpha feather at cuticle base via destination-in
 * 3) Stamped smoothly onto live camera frame anchored at cuticle (cuticleX, cuticleY)
 */
export function renderSingleNail(
  ctx: CanvasRenderingContext2D,
  cuticleX: number,
  cuticleY: number,
  baseWidth: number,
  baseHeight: number,
  angleRad: number,
  design: NailDesign,
  adjustment: NailAdjustment
): void {
  const shapeFactor = SHAPE_LENGTH_FACTOR[adjustment.shape] ?? 1;
  const finalW = Math.max(8, baseWidth * adjustment.scale);
  const finalH = Math.max(12, baseHeight * adjustment.scale * adjustment.extensionLength * shapeFactor);
  const finalAngle = angleRad + (adjustment.rotationDeg * Math.PI) / 180;

  const pad = Math.ceil(Math.max(14, finalW * 0.35));
  const bufW = Math.ceil(finalW + pad * 2);
  const bufH = Math.ceil(finalH + pad * 2);
  const buffer = getNailBuffer(bufW, bufH);
  if (!buffer) return;

  const { canvas: offCanvas, ctx: bCtx } = buffer;
  const originX = bufW / 2;
  const originY = bufH - pad;
  const hw = finalW / 2;

  // --- Compose layered realistic gel nail in offscreen buffer ---
  bCtx.save();
  bCtx.translate(originX, originY);

  traceCuticleAnchoredNailPath(bCtx, finalW, finalH, adjustment.shape);
  bCtx.save();
  bCtx.clip();

  // Layer A: Extracted pure nail-plate texture OR procedural gel polish
  const customImg = design.imageDataUrl ? getCachedImage(design.imageDataUrl) : null;
  if (customImg) {
    const imgRatio = customImg.naturalWidth / customImg.naturalHeight;
    const nailRatio = finalW / finalH;
    let drawW = finalW;
    let drawH = finalH;
    if (imgRatio > nailRatio) {
      drawH = finalH;
      drawW = finalH * imgRatio;
    } else {
      drawW = finalW;
      drawH = finalW / imgRatio;
    }
    bCtx.drawImage(customImg, -drawW / 2, -finalH / 2 - drawH / 2, drawW, drawH);
  } else {
    drawProceduralPattern(bCtx, design, finalW, finalH);
  }

  // Layer B: 3D cylindrical internal occlusion shading along lateral sidewalls
  const cylOcclusion = bCtx.createLinearGradient(-hw, 0, hw, 0);
  cylOcclusion.addColorStop(0, 'rgba(20, 9, 12, 0.38)');
  cylOcclusion.addColorStop(0.14, 'rgba(20, 9, 12, 0.14)');
  cylOcclusion.addColorStop(0.36, 'rgba(255, 255, 255, 0.06)');
  cylOcclusion.addColorStop(0.60, 'rgba(255, 255, 255, 0.04)');
  cylOcclusion.addColorStop(0.86, 'rgba(20, 9, 12, 0.16)');
  cylOcclusion.addColorStop(1, 'rgba(20, 9, 12, 0.40)');
  bCtx.fillStyle = cylOcclusion;
  bCtx.fillRect(-hw * 1.1, -finalH * 1.1, finalW * 1.1, finalH * 1.2);

  // Layer C: Subtle inner cuticle fold depth + free-edge translucent gel apex glow
  const longitudinalDepth = bCtx.createLinearGradient(0, -finalH, 0, 0);
  longitudinalDepth.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
  longitudinalDepth.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  longitudinalDepth.addColorStop(0.82, 'rgba(28, 12, 16, 0.12)');
  longitudinalDepth.addColorStop(1, 'rgba(24, 10, 14, 0.30)');
  bCtx.fillStyle = longitudinalDepth;
  bCtx.fillRect(-hw * 1.1, -finalH * 1.1, finalW * 1.1, finalH * 1.2);

  // Layer D: Angle-reactive specular gel topcoat highlight (glides as finger tilts!)
  const tiltFactor = clamp(Math.sin(finalAngle), -1, 1);
  const specShiftX = -hw * 0.16 + tiltFactor * hw * 0.34;
  const glossStrength =
    design.finish === 'velvet'
      ? 0.24
      : design.finish === 'chrome'
        ? 0.64
        : design.finish === 'glitter'
          ? 0.50
          : 0.52;

  const specGrad = bCtx.createLinearGradient(
    specShiftX - finalW * 0.16,
    -finalH * 0.92,
    specShiftX + finalW * 0.18,
    -finalH * 0.12
  );
  specGrad.addColorStop(0, `rgba(255, 255, 255, ${glossStrength * 0.95})`);
  specGrad.addColorStop(0.32, `rgba(255, 255, 255, ${glossStrength * 0.65})`);
  specGrad.addColorStop(0.68, `rgba(255, 255, 255, ${glossStrength * 0.18})`);
  specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

  bCtx.fillStyle = specGrad;
  bCtx.beginPath();
  bCtx.ellipse(
    specShiftX,
    -finalH * 0.56,
    finalW * 0.115,
    finalH * 0.36,
    -0.06 + tiltFactor * 0.12,
    0,
    Math.PI * 2
  );
  bCtx.fill();

  // Sharp studio pinpoint reflection near gel apex curve
  bCtx.fillStyle = `rgba(255, 255, 255, ${glossStrength * 0.72})`;
  bCtx.beginPath();
  bCtx.ellipse(
    specShiftX * 0.9,
    -finalH * 0.72,
    finalW * 0.042,
    finalH * 0.13,
    -0.05 + tiltFactor * 0.1,
    0,
    Math.PI * 2
  );
  bCtx.fill();

  // Subtle counter-rim bounce light on opposite edge
  const rimSide = tiltFactor >= 0 ? -1 : 1;
  bCtx.fillStyle = `rgba(255, 248, 244, ${glossStrength * 0.24})`;
  bCtx.beginPath();
  bCtx.ellipse(
    rimSide * hw * 0.66,
    -finalH * 0.52,
    finalW * 0.035,
    finalH * 0.26,
    0,
    0,
    Math.PI * 2
  );
  bCtx.fill();

  bCtx.restore(); // pop clip

  // Subtle inner edge rim definition (only upper 82% — avoids hard rim on cuticle)
  bCtx.save();
  traceCuticleAnchoredNailPath(bCtx, finalW, finalH, adjustment.shape);
  const rimStroke = bCtx.createLinearGradient(0, -finalH, 0, 0);
  rimStroke.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
  rimStroke.addColorStop(0.75, 'rgba(255, 255, 255, 0.08)');
  rimStroke.addColorStop(1, 'rgba(255, 255, 255, 0)');
  bCtx.strokeStyle = rimStroke;
  bCtx.lineWidth = Math.max(0.7, finalW * 0.02);
  bCtx.stroke();
  bCtx.restore();

  // Layer E: Cuticle Skin-Melt Feather Mask (destination-in removes harsh sticker line at cuticle!)
  bCtx.globalCompositeOperation = 'destination-in';
  const cuticleFeather = bCtx.createLinearGradient(0, -finalH * 0.22, 0, 1);
  cuticleFeather.addColorStop(0, 'rgba(0, 0, 0, 1)');
  cuticleFeather.addColorStop(0.42, 'rgba(0, 0, 0, 0.94)');
  cuticleFeather.addColorStop(0.76, 'rgba(0, 0, 0, 0.48)');
  cuticleFeather.addColorStop(1, 'rgba(0, 0, 0, 0)');
  bCtx.fillStyle = cuticleFeather;
  bCtx.fillRect(-hw * 1.2, -finalH * 1.2, finalW * 2.4, finalH * 1.4);
  bCtx.restore();

  // --- Stamp shadow + feathered gel nail onto live AR canvas ---
  ctx.save();
  ctx.translate(cuticleX, cuticleY);
  ctx.rotate(finalAngle);

  // Soft warm skin-contact shadow under free edge and lateral folds
  ctx.save();
  ctx.globalAlpha = adjustment.opacity * 0.55;
  traceCuticleAnchoredNailPath(ctx, finalW * 1.02, finalH * 1.01, adjustment.shape);
  ctx.shadowColor = 'rgba(26, 12, 12, 0.42)';
  ctx.shadowBlur = Math.max(4, finalW * 0.22);
  ctx.shadowOffsetX = tiltFactor * 2.2;
  ctx.shadowOffsetY = Math.max(1.2, finalW * 0.06);
  ctx.fillStyle = 'rgba(20, 10, 10, 0.06)';
  ctx.fill();
  ctx.restore();

  // Composite the feathered 3D gel nail onto the finger
  ctx.globalAlpha = adjustment.opacity;
  ctx.drawImage(offCanvas, 0, 0, bufW, bufH, -originX, -originY, bufW, bufH);
  ctx.restore();
}

/**
 * Aligns every nail anatomically using each finger's individual DIP -> TIP vector,
 * anchoring the cuticle line slightly below the midpoint between DIP and TIP
 * so extensions grow naturally outward past the fingertip.
 */
export function renderNailsOnRect(
  ctx: CanvasRenderingContext2D,
  rect: ImageLayoutRect,
  poses: FingerPose[],
  design: NailDesign,
  adjustment: NailAdjustment,
  mirrorX = false
): void {
  for (const pose of poses) {
    const tipX = rect.drawX + (mirrorX ? 1 - pose.tip.x : pose.tip.x) * rect.drawW;
    const tipY = rect.drawY + pose.tip.y * rect.drawH;
    const dipX = rect.drawX + (mirrorX ? 1 - pose.dip.x : pose.dip.x) * rect.drawW;
    const dipY = rect.drawY + pose.dip.y * rect.drawH;

    // Exact directional vector from distal joint (DIP) toward fingertip (TIP)
    const dx = tipX - dipX;
    const dy = tipY - dipY;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 4) continue;

    // Align local -Y axis along finger vector (dx, dy)
    const angle = Math.atan2(dy, dx) + Math.PI / 2;

    // Anchor cuticle base slightly below the DIP->TIP midpoint (0.42 for fingers, 0.46 for thumb)
    const cuticleT = pose.id === 'thumb' ? 0.46 : 0.42;
    const cuticleX = dipX + dx * cuticleT;
    const cuticleY = dipY + dy * cuticleT;

    const nailW = pose.widthScale * rect.drawW;
    const nailH = Math.max(pose.lengthScale * rect.drawH, segLen * 0.85);

    renderSingleNail(ctx, cuticleX, cuticleY, nailW, nailH, angle, design, adjustment);
  }
}

function shadeHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  const r = clamp(((num >> 16) & 0xff) + amount, 0, 255);
  const g = clamp(((num >> 8) & 0xff) + amount, 0, 255);
  const b = clamp((num & 0xff) + amount, 0, 255);
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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

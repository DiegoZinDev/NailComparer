import type { FingerPose, NailAdjustment, NailDesign } from '../types/nail';

// Exact calibrated poses on /hand-demo.png (896x1200 portrait)
export const DEMO_HAND_POSES: FingerPose[] = [
  {
    id: 'thumb',
    tip: { x: 0.142, y: 0.456 },
    dip: { x: 0.195, y: 0.528 },
    widthScale: 0.056,
    lengthScale: 0.072,
  },
  {
    id: 'index',
    tip: { x: 0.335, y: 0.188 },
    dip: { x: 0.337, y: 0.275 },
    widthScale: 0.056,
    lengthScale: 0.078,
  },
  {
    id: 'middle',
    tip: { x: 0.494, y: 0.148 },
    dip: { x: 0.494, y: 0.238 },
    widthScale: 0.058,
    lengthScale: 0.080,
  },
  {
    id: 'ring',
    tip: { x: 0.642, y: 0.210 },
    dip: { x: 0.637, y: 0.296 },
    widthScale: 0.055,
    lengthScale: 0.076,
  },
  {
    id: 'pinky',
    tip: { x: 0.802, y: 0.348 },
    dip: { x: 0.778, y: 0.425 },
    widthScale: 0.046,
    lengthScale: 0.066,
  },
];

// Finger landmark indices from MediaPipe HandLandmarker (21 points)
export const MEDIAPIPE_FINGER_PAIRS: Array<{
  id: FingerPose['id'];
  tipIdx: number;
  dipIdx: number;
  pipIdx: number;
  widthFactor: number;
  lengthFactor: number;
}> = [
  { id: 'thumb', tipIdx: 4, dipIdx: 3, pipIdx: 2, widthFactor: 0.56, lengthFactor: 0.86 },
  { id: 'index', tipIdx: 8, dipIdx: 7, pipIdx: 6, widthFactor: 0.52, lengthFactor: 0.88 },
  { id: 'middle', tipIdx: 12, dipIdx: 11, pipIdx: 10, widthFactor: 0.54, lengthFactor: 0.90 },
  { id: 'ring', tipIdx: 16, dipIdx: 15, pipIdx: 14, widthFactor: 0.50, lengthFactor: 0.88 },
  { id: 'pinky', tipIdx: 20, dipIdx: 19, pipIdx: 18, widthFactor: 0.45, lengthFactor: 0.84 },
];

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
 * Builds an organic nail path centered at (0, 0), pointing UP along -Y.
 */
function traceNailShapePath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  shape: NailAdjustment['shape']
): void {
  const hw = w / 2;
  const hh = h / 2;

  ctx.beginPath();
  if (shape === 'coffin') {
    // Tapered ballerina / coffin luxury silhouette
    const tipHw = hw * 0.56;
    ctx.moveTo(-tipHw, -hh * 0.96);
    ctx.quadraticCurveTo(0, -hh * 1.03, tipHw, -hh * 0.96);
    ctx.bezierCurveTo(hw * 0.85, -hh * 0.35, hw * 1.04, hh * 0.3, hw * 0.92, hh * 0.72);
    ctx.quadraticCurveTo(hw * 0.68, hh * 1.04, 0, hh * 1.02);
    ctx.quadraticCurveTo(-hw * 0.68, hh * 1.04, -hw * 0.92, hh * 0.72);
    ctx.bezierCurveTo(-hw * 1.04, hh * 0.3, -hw * 0.85, -hh * 0.35, -tipHw, -hh * 0.96);
  } else if (shape === 'oval') {
    // Soft classic oval
    ctx.moveTo(0, -hh);
    ctx.bezierCurveTo(hw * 0.86, -hh, hw * 1.04, -hh * 0.25, hw * 0.94, hh * 0.62);
    ctx.bezierCurveTo(hw * 0.82, hh * 1.04, -hw * 0.82, hh * 1.04, -hw * 0.94, hh * 0.62);
    ctx.bezierCurveTo(-hw * 1.04, -hh * 0.25, -hw * 0.86, -hh, 0, -hh);
  } else {
    // Almond luxury silhouette (default)
    ctx.moveTo(0, -hh * 1.06);
    ctx.bezierCurveTo(hw * 0.66, -hh * 0.92, hw * 1.06, -hh * 0.14, hw * 0.94, hh * 0.64);
    ctx.bezierCurveTo(hw * 0.78, hh * 1.04, -hw * 0.78, hh * 1.04, -hw * 0.94, hh * 0.64);
    ctx.bezierCurveTo(-hw * 1.06, -hh * 0.14, -hw * 0.66, -hh * 0.92, 0, -hh * 1.06);
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

function drawProceduralPattern(
  ctx: CanvasRenderingContext2D,
  design: NailDesign,
  w: number,
  h: number
): void {
  const hw = w / 2;
  const hh = h / 2;
  const base = design.baseColor || '#E8C5BA';
  const secondary = design.secondaryColor || '#FFFFFF';
  const accent = design.accentColor || '#D4AF37';

  // Base gradient giving 3D cylindrical nail curvature
  const cylGrad = ctx.createLinearGradient(-hw, 0, hw, 0);
  cylGrad.addColorStop(0, shadeHex(base, -18));
  cylGrad.addColorStop(0.28, shadeHex(base, 8));
  cylGrad.addColorStop(0.55, shadeHex(base, 14));
  cylGrad.addColorStop(0.82, base);
  cylGrad.addColorStop(1, shadeHex(base, -22));
  ctx.fillStyle = cylGrad;
  ctx.fillRect(-hw * 1.2, -hh * 1.2, w * 1.2, h * 1.2);

  switch (design.patternType) {
    case 'french': {
      // Soft translucent gel bed + crisp smile line at tip
      const isMicro = design.name.toLowerCase().includes('micro');
      const tipDepth = isMicro ? -hh * 0.56 : -hh * 0.28;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-hw * 1.15, -hh * 1.25);
      ctx.lineTo(hw * 1.15, -hh * 1.25);
      ctx.lineTo(hw * 1.15, tipDepth + hh * 0.14);
      ctx.quadraticCurveTo(0, tipDepth - hh * 0.24, -hw * 1.15, tipDepth + hh * 0.14);
      ctx.closePath();

      const tipGrad = ctx.createLinearGradient(-hw, -hh, hw, tipDepth);
      tipGrad.addColorStop(0, shadeHex(secondary, -8));
      tipGrad.addColorStop(0.5, secondary);
      tipGrad.addColorStop(1, shadeHex(secondary, -10));
      ctx.fillStyle = tipGrad;
      ctx.fill();

      // Delicate smile highlight line
      ctx.strokeStyle = accent;
      ctx.globalAlpha *= 0.55;
      ctx.lineWidth = Math.max(1, w * 0.03);
      ctx.beginPath();
      ctx.moveTo(-hw * 1.05, tipDepth + hh * 0.13);
      ctx.quadraticCurveTo(0, tipDepth - hh * 0.23, hw * 1.05, tipDepth + hh * 0.13);
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'ombre': {
      const ombreGrad = ctx.createLinearGradient(0, -hh * 0.95, 0, hh * 0.95);
      ombreGrad.addColorStop(0, secondary);
      ombreGrad.addColorStop(0.36, mixHex(secondary, base, 0.45));
      ombreGrad.addColorStop(0.75, base);
      ombreGrad.addColorStop(1, shadeHex(base, -12));
      ctx.fillStyle = ombreGrad;
      ctx.fillRect(-hw * 1.2, -hh * 1.2, w * 1.2, h * 1.2);
      break;
    }

    case 'chrome': {
      // Liquid pearl mirror reflection
      const mirror = ctx.createLinearGradient(-hw, -hh, hw, hh);
      mirror.addColorStop(0, shadeHex(base, -16));
      mirror.addColorStop(0.28, secondary);
      mirror.addColorStop(0.52, accent);
      mirror.addColorStop(0.76, '#FFFFFF');
      mirror.addColorStop(1, shadeHex(base, -22));
      ctx.fillStyle = mirror;
      ctx.fillRect(-hw * 1.2, -hh * 1.2, w * 1.2, h * 1.2);

      // Subtle iridescent halo
      const halo = ctx.createRadialGradient(-hw * 0.2, -hh * 0.25, w * 0.05, 0, 0, h * 0.8);
      halo.addColorStop(0, 'rgba(255,255,255,0.65)');
      halo.addColorStop(0.5, 'rgba(248, 224, 214, 0.16)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-hw * 1.2, -hh * 1.2, w * 1.2, h * 1.2);
      break;
    }

    case 'marble': {
      // Rose quartz organic milky veins + gold flecks
      const milky = ctx.createRadialGradient(0, -hh * 0.1, w * 0.1, 0, 0, h);
      milky.addColorStop(0, 'rgba(255,255,255,0.42)');
      milky.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = milky;
      ctx.fillRect(-hw * 1.2, -hh * 1.2, w * 1.2, h * 1.2);

      ctx.save();
      ctx.strokeStyle = secondary;
      ctx.globalAlpha *= 0.62;
      ctx.lineWidth = Math.max(1, w * 0.055);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-hw * 0.85, -hh * 0.55);
      ctx.bezierCurveTo(-hw * 0.1, -hh * 0.2, hw * 0.3, hh * 0.15, hw * 0.78, hh * 0.65);
      ctx.stroke();

      ctx.lineWidth = Math.max(0.8, w * 0.03);
      ctx.beginPath();
      ctx.moveTo(hw * 0.5, -hh * 0.7);
      ctx.bezierCurveTo(hw * 0.05, -hh * 0.1, -hw * 0.4, hh * 0.2, -hw * 0.65, hh * 0.8);
      ctx.stroke();

      // Fine gold vein accent
      ctx.strokeStyle = accent;
      ctx.globalAlpha *= 0.8;
      ctx.lineWidth = Math.max(0.7, w * 0.024);
      ctx.beginPath();
      ctx.moveTo(-hw * 0.3, -hh * 0.45);
      ctx.quadraticCurveTo(hw * 0.18, 0, hw * 0.45, hh * 0.55);
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'gold-foil': {
      // Deep base + irregular gold foil flakes
      ctx.save();
      ctx.fillStyle = secondary;
      const flakes = [
        [-0.24, -0.35, 0.26, 0.18, 0.4],
        [0.18, -0.08, 0.3, 0.16, -0.5],
        [-0.12, 0.28, 0.22, 0.15, 0.2],
        [0.06, -0.58, 0.16, 0.11, -0.2],
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
      // Velvet magnetic diagonal beam
      const beam = ctx.createRadialGradient(
        -hw * 0.08,
        -hh * 0.12,
        w * 0.02,
        0,
        0,
        h * 0.72
      );
      beam.addColorStop(0, accent);
      beam.addColorStop(0.28, secondary);
      beam.addColorStop(0.68, base);
      beam.addColorStop(1, shadeHex(base, -30));
      ctx.fillStyle = beam;
      ctx.fillRect(-hw * 1.2, -hh * 1.2, w * 1.2, h * 1.2);
      break;
    }

    case 'aurora': {
      const aura = ctx.createLinearGradient(-hw, -hh, hw, hh);
      aura.addColorStop(0, base);
      aura.addColorStop(0.35, secondary);
      aura.addColorStop(0.7, accent);
      aura.addColorStop(1, '#E6D6F5');
      ctx.fillStyle = aura;
      ctx.fillRect(-hw * 1.2, -hh * 1.2, w * 1.2, h * 1.2);
      break;
    }

    case 'solid':
    default:
      break;
  }
}

export function renderSingleNail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  angleRad: number,
  design: NailDesign,
  adjustment: NailAdjustment
): void {
  const finalW = width * adjustment.scale;
  const finalH = height * adjustment.scale;
  const finalAngle = angleRad + (adjustment.rotationDeg * Math.PI) / 180;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(finalAngle);
  ctx.globalAlpha = adjustment.opacity;

  // Soft ambient contact shadow under cuticle/nail edge
  ctx.save();
  traceNailShapePath(ctx, finalW * 1.03, finalH * 1.02, adjustment.shape);
  ctx.shadowColor = 'rgba(18, 10, 12, 0.34)';
  ctx.shadowBlur = Math.max(4, finalW * 0.18);
  ctx.shadowOffsetY = Math.max(1.5, finalH * 0.04);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fill();
  ctx.restore();

  // Clip to exact nail silhouette
  traceNailShapePath(ctx, finalW, finalH, adjustment.shape);
  ctx.save();
  ctx.clip();

  const customImg = design.imageDataUrl ? getCachedImage(design.imageDataUrl) : null;
  if (customImg) {
    // Cover-fit customer reference image onto nail bed
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
    ctx.drawImage(customImg, -drawW / 2, -drawH / 2, drawW, drawH);

    // Subtle 3D cylindrical edge shading over custom photo so it wraps naturally
    const wrapShade = ctx.createLinearGradient(-finalW / 2, 0, finalW / 2, 0);
    wrapShade.addColorStop(0, 'rgba(15, 10, 12, 0.26)');
    wrapShade.addColorStop(0.22, 'rgba(255, 255, 255, 0.05)');
    wrapShade.addColorStop(0.55, 'rgba(255, 255, 255, 0.08)');
    wrapShade.addColorStop(1, 'rgba(15, 10, 12, 0.28)');
    ctx.fillStyle = wrapShade;
    ctx.fillRect(-finalW * 0.6, -finalH * 0.6, finalW * 1.2, finalH * 1.2);
  } else {
    drawProceduralPattern(ctx, design, finalW, finalH);
  }

  // Cuticle inner shadow for authentic seated gel look
  const cuticleShadow = ctx.createLinearGradient(0, finalH * 0.25, 0, finalH * 0.56);
  cuticleShadow.addColorStop(0, 'rgba(30, 15, 18, 0)');
  cuticleShadow.addColorStop(1, 'rgba(28, 12, 16, 0.28)');
  ctx.fillStyle = cuticleShadow;
  ctx.fillRect(-finalW * 0.6, finalH * 0.15, finalW * 1.2, finalH * 0.45);

  // Specular studio softbox gloss highlight along left-center crest
  const glossAlpha = design.finish === 'velvet' ? 0.28 : design.finish === 'chrome' ? 0.62 : 0.48;
  const specGrad = ctx.createLinearGradient(-finalW * 0.28, -finalH * 0.44, finalW * 0.12, finalH * 0.36);
  specGrad.addColorStop(0, `rgba(255, 255, 255, ${glossAlpha})`);
  specGrad.addColorStop(0.45, `rgba(255, 255, 255, ${glossAlpha * 0.45})`);
  specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = specGrad;
  ctx.beginPath();
  ctx.ellipse(
    -finalW * 0.15,
    -finalH * 0.05,
    finalW * 0.11,
    finalH * 0.36,
    -0.08,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Secondary micro-glint near tip
  ctx.fillStyle = `rgba(255, 255, 255, ${glossAlpha * 0.55})`;
  ctx.beginPath();
  ctx.ellipse(
    finalW * 0.16,
    -finalH * 0.24,
    finalW * 0.04,
    finalH * 0.12,
    0.15,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.restore(); // pop clip

  // Hairline translucent gel rim
  traceNailShapePath(ctx, finalW, finalH, adjustment.shape);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = Math.max(0.75, finalW * 0.022);
  ctx.stroke();

  ctx.restore();
}

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

    // Vector from DIP joint toward TIP
    const dx = tipX - dipX;
    const dy = tipY - dipY;
    // Rotate nail local -Y axis along (dx, dy)
    const angle = Math.atan2(dy, dx) + Math.PI / 2;

    // Position center slightly below fingertip point so nail covers bed + free edge
    const centerX = tipX - dx * 0.12;
    const centerY = tipY - dy * 0.12;

    const nailW = pose.widthScale * rect.drawW;
    const nailH = pose.lengthScale * rect.drawH;

    renderSingleNail(ctx, centerX, centerY, nailW, nailH, angle, design, adjustment);
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

import { useEffect, useRef } from "react";

interface Props {
  /** 0–100 progress percentage */
  progress: number;
}

// ── Constants ────────────────────────────────────────────────────

const W = 500;
const H = 200;
const BOX_W = 220;
const BOX_H = 130;
const BOX_X = (W - BOX_W) / 2;
const BOX_Y = 38;

// ── Color palette ────────────────────────────────────────────────

const COLORS = [
  "#e57373", "#f06292", "#ba68c8", "#9575cd",
  "#64b5f6", "#4fc3f7", "#4dd0e1", "#4db6ac",
  "#81c784", "#aed581", "#ffd54f", "#ffb74d",
  "#ff8a65", "#a1887f", "#90a4ae",
];

// ── Component ────────────────────────────────────────────────────

export const PackingAnimation = ({ progress }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Pre-generate items with fixed random seed
    const rng = mulberry32(42);
    const totalItems = 30;
    const items = Array.from({ length: totalItems }, () => ({
      color: COLORS[Math.floor(rng() * COLORS.length)],
      w: 12 + rng() * 10,
      h: 8 + rng() * 6,
      delay: rng() * 0.8, // seconds offset
    }));

    const draw = (timestamp: number) => {
      const t = timestamp / 1000;
      const p = progressRef.current;

      ctx.clearRect(0, 0, W, H);

      // ── Background ──
      drawBackground(ctx);

      // ── Shadow under box ──
      drawBoxShadow(ctx);

      // ── Box (interior fill) ──
      drawBoxFill(ctx, p);

      // ── Items inside box ──
      const filledCount = Math.floor((p / 100) * totalItems);
      drawItems(ctx, items, filledCount, t, p);

      // ── Box walls ──
      drawBoxWalls(ctx, p);

      // ── Falling items (during packing) ──
      if (p > 5 && p < 100) {
        drawFallingItem(ctx, t, p);
      }

      // ── Completion effects ──
      if (p >= 100) {
        drawCompletion(ctx, t);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="packages-canvas"
      width={W}
      height={H}
      style={{ width: "100%", maxWidth: W, height: "auto" }}
    />
  );
};

// ═══════════════════════════════════════════════════════════════
// Drawing functions
// ═══════════════════════════════════════════════════════════════

function drawBackground(ctx: CanvasRenderingContext2D) {
  // Soft gradient background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#f8f6f0");
  bg.addColorStop(1, "#ece8e0");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
}

function drawBoxShadow(ctx: CanvasRenderingContext2D) {
  // Soft shadow beneath the box — elongated ellipse
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.07)";
  ctx.beginPath();
  ctx.ellipse(
    BOX_X + BOX_W / 2,
    BOX_Y + BOX_H + 8,
    BOX_W / 2 + 10,
    6,
    0, 0, Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

function drawBoxFill(ctx: CanvasRenderingContext2D, progress: number) {
  const fillPct = Math.min(progress / 100, 1);
  if (fillPct <= 0) return;

  const inset = 5;
  const fillH = (BOX_H - inset * 2) * fillPct;
  const fx = BOX_X + inset;
  const fy = BOX_Y + BOX_H - inset - fillH;

  // Gradient fill for visual depth
  const grad = ctx.createLinearGradient(fx, fy, fx, fy + fillH);
  grad.addColorStop(0, "#d4b85a");
  grad.addColorStop(0.4, "#c9a84a");
  grad.addColorStop(1, "#b8943e");
  ctx.fillStyle = grad;

  // Rounded fill area
  const r = 3;
  ctx.beginPath();
  ctx.moveTo(fx + r, fy);
  ctx.lineTo(fx + BOX_W - inset * 2 - r, fy);
  ctx.quadraticCurveTo(fx + BOX_W - inset * 2, fy, fx + BOX_W - inset * 2, fy + r);
  ctx.lineTo(fx + BOX_W - inset * 2, fy + fillH);
  ctx.lineTo(fx, fy + fillH);
  ctx.lineTo(fx, fy + r);
  ctx.quadraticCurveTo(fx, fy, fx + r, fy);
  ctx.closePath();
  ctx.fill();

  // Top highlight line
  if (fillPct < 1) {
    ctx.fillStyle = "rgba(255,255,200,0.25)";
    ctx.fillRect(fx + 4, fy, BOX_W - inset * 2 - 8, 3);
  }

  // Corrugation pattern on fill
  ctx.strokeStyle = "rgba(154,126,50,0.15)";
  ctx.lineWidth = 1;
  const corrStart = Math.max(fy, BOX_Y + 20);
  for (let ly = corrStart; ly < BOX_Y + BOX_H - inset; ly += 8) {
    const relY = ly - fy;
    if (relY < 0 || relY > fillH) continue;
    ctx.beginPath();
    ctx.moveTo(fx + 4, ly);
    for (let lx = fx + 4; lx < fx + BOX_W - inset * 2 - 4; lx += 6) {
      ctx.lineTo(lx + 3, ly + 2);
      ctx.lineTo(lx + 6, ly);
    }
    ctx.stroke();
  }
}

function drawBoxWalls(ctx: CanvasRenderingContext2D, progress: number) {
  ctx.fillStyle = "#c8a84a";
  // Left wall
  ctx.fillRect(BOX_X, BOX_Y + 4, 5, BOX_H - 4);
  // Right wall
  ctx.fillRect(BOX_X + BOX_W - 5, BOX_Y + 4, 5, BOX_H - 4);
  // Bottom wall
  ctx.fillRect(BOX_X, BOX_Y + BOX_H - 5, BOX_W, 5);

  // ── Box outline ──
  ctx.strokeStyle = "#9a7e32";
  ctx.lineWidth = 2;
  ctx.strokeRect(BOX_X, BOX_Y, BOX_W, BOX_H);

  // ── Label / badge ──
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(BOX_X + 50, BOX_Y + 22, BOX_W - 100, 32, 4);
  ctx.fill();
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#888";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TRANSLATION PACK", BOX_X + BOX_W / 2, BOX_Y + 36);

  // ── Open flaps (before completion) ──
  if (progress < 100) {
    // Left flap
    ctx.fillStyle = "#dbb85a";
    ctx.beginPath();
    ctx.moveTo(BOX_X - 16, BOX_Y - 2);
    ctx.lineTo(BOX_X + 4, BOX_Y - 12);
    ctx.lineTo(BOX_X + 4, BOX_Y + 4);
    ctx.lineTo(BOX_X, BOX_Y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#9a7e32";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Right flap
    ctx.beginPath();
    ctx.moveTo(BOX_X + BOX_W + 16, BOX_Y - 2);
    ctx.lineTo(BOX_X + BOX_W - 4, BOX_Y - 12);
    ctx.lineTo(BOX_X + BOX_W - 4, BOX_Y + 4);
    ctx.lineTo(BOX_X + BOX_W, BOX_Y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Back flap
    ctx.fillStyle = "#b8943e";
    ctx.fillRect(BOX_X + 4, BOX_Y - 10, BOX_W - 8, 8);
    ctx.strokeStyle = "#9a7e32";
    ctx.lineWidth = 1;
    ctx.strokeRect(BOX_X + 4, BOX_Y - 10, BOX_W - 8, 8);
  }
}

function drawItems(
  ctx: CanvasRenderingContext2D,
  itemData: { color: string; w: number; h: number; delay: number }[],
  count: number,
  t: number,
  progress: number,
) {
  const inset = 8;
  const startX = BOX_X + inset;
  const startY = BOX_Y + BOX_H - inset;
  const cols = 7;
  const cellW = (BOX_W - inset * 2) / cols;

  for (let i = 0; i < Math.min(count, itemData.length); i++) {
    const item = itemData[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ix = startX + col * cellW + (cellW - item.w) / 2;
    const iy = startY - (row + 1) * 11 + (cellW - item.h) / 2;

    // Drop animation for the last 3 placed items
    let visualY = iy;
    if (i >= count - 3 && count > 1 && progress < 100) {
      const age = ((t + item.delay * 2) * 1000) % 400;
      const dropPct = Math.min(age / 250, 1);
      visualY = iy - (1 - dropPct) * 25 * easeOutCubic(1 - dropPct);
    }

    // Item body
    ctx.fillStyle = item.color;
    const r = 2;
    ctx.beginPath();
    ctx.roundRect(ix, visualY, item.w, item.h, r);
    ctx.fill();

    // Subtle highlight
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(ix + 2, visualY + 1, item.w - 5, 2);
  }
}

function drawFallingItem(ctx: CanvasRenderingContext2D, t: number, progress: number) {
  const cycle = 0.8 + (1 - progress / 100) * 0.6;
  const phase = (t % cycle) / cycle;

  const startY = 6;
  const endY = BOX_Y + 20;
  const itemX = BOX_X + BOX_W / 2 + Math.sin(t * 2.5) * 25;

  const y = startY + (endY - startY) * easeOutBounce(phase);
  const size = 10 + Math.sin(t * 4) * 1.5;
  const alpha = phase < 0.92 ? 1 : Math.max(0, (1 - phase) * 12.5);

  ctx.save();
  ctx.globalAlpha = alpha;
  const ci = Math.floor(t * 1.5) % COLORS.length;
  ctx.fillStyle = COLORS[ci];
  ctx.beginPath();
  ctx.roundRect(itemX - size / 2, y - size / 2, size, size, 2);
  ctx.fill();

  // Tiny trail
  if (y > startY + 5) {
    ctx.fillStyle = "rgba(100,100,100,0.08)";
    ctx.fillRect(itemX - 1.5, y - 14, 3, 12);
  }
  ctx.restore();
}

function drawCompletion(ctx: CanvasRenderingContext2D, t: number) {
  const sealTime = t * 0.8;

  // ── Close flaps ──
  const flapPhase = Math.min(sealTime * 2, 1);

  // Left flap closing
  if (flapPhase > 0) {
    const closeY = -10 + 10 * easeOutBack(Math.min(flapPhase * 2, 1));
    ctx.fillStyle = "#dbb85a";
    ctx.beginPath();
    ctx.moveTo(BOX_X - 16 + 16 * easeOutBack(flapPhase), BOX_Y - 2 + 2 * easeOutBack(flapPhase));
    ctx.lineTo(BOX_X + 4, BOX_Y + closeY);
    ctx.lineTo(BOX_X + 4, BOX_Y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#9a7e32";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Right flap closing (delayed)
  const rightPhase = Math.max(0, (flapPhase - 0.2) / 0.8);
  if (rightPhase > 0) {
    const closeY = -10 + 10 * easeOutBack(Math.min(rightPhase * 2, 1));
    ctx.fillStyle = "#dbb85a";
    ctx.beginPath();
    ctx.moveTo(BOX_X + BOX_W + 16 - 16 * easeOutBack(rightPhase), BOX_Y - 2 + 2 * easeOutBack(rightPhase));
    ctx.lineTo(BOX_X + BOX_W - 4, BOX_Y + closeY);
    ctx.lineTo(BOX_X + BOX_W - 4, BOX_Y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#9a7e32";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Tape / seal ──
  const tapePhase = Math.max(0, (flapPhase - 0.5) / 0.5);
  if (tapePhase > 0) {
    const alpha = Math.min(tapePhase * 3, 1);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Center tape strip
    ctx.fillStyle = "#e0dcc8";
    ctx.shadowColor = "rgba(0,0,0,0.08)";
    ctx.shadowBlur = 3;
    ctx.fillRect(BOX_X + BOX_W / 2 - 3, BOX_Y - 14, 6, BOX_H + 28);
    ctx.shadowBlur = 0;

    // Left edge tape
    ctx.fillStyle = "#e0dcc8";
    ctx.fillRect(BOX_X + 5, BOX_Y - 10, 4, BOX_H + 20);

    // Right edge tape
    ctx.fillRect(BOX_X + BOX_W - 9, BOX_Y - 10, 4, BOX_H + 20);

    ctx.restore();

    // ── "PACKED" stamp ──
    const stampPhase = Math.max(0, (tapePhase - 0.3) / 0.7);
    if (stampPhase > 0) {
      ctx.save();
      ctx.globalAlpha = stampPhase;
      ctx.translate(BOX_X + BOX_W / 2, BOX_Y + BOX_H / 2);
      ctx.rotate(-0.12);

      // Stamp outline
      ctx.strokeStyle = "#c0392b";
      ctx.lineWidth = 2.5;
      const sw = 130;
      const sh = 36;
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);

      // Stamp fill
      ctx.fillStyle = "rgba(192,57,43,0.06)";
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);

      // Stamp text
      ctx.fillStyle = "#c0392b";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PACKED ✓", 0, 0);

      ctx.restore();
    }
  }

  // ── Sparkle particles ──
  const sparkleTime = Math.max(0, sealTime - 0.3);
  if (sparkleTime > 0) {
    for (let i = 0; i < 12; i++) {
      const seed = i * 1.618;
      const angle = (seed * 0.8 + sparkleTime * 0.5) % (Math.PI * 2);
      const dist = 30 + (seed * 0.3 + sparkleTime * 1.2) % 80;
      const px = BOX_X + BOX_W / 2 + Math.cos(angle) * dist;
      const py = BOX_Y + BOX_H / 2 + Math.sin(angle) * dist;
      const sz = 2 + (seed * 0.7 + sparkleTime * 3) % 3;
      const alpha2 = Math.max(0, 1 - (sparkleTime * 0.4 + i * 0.04));

      if (alpha2 > 0.05) {
        ctx.save();
        ctx.globalAlpha = alpha2;
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Easing functions
// ═══════════════════════════════════════════════════════════════

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Simple seeded random
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

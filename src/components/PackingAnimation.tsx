import { useEffect, useRef } from "react";

interface Props {
  /** 0–100 progress percentage */
  progress: number;
}

// ── Constants ────────────────────────────────────────────────────

const W = 700;
const H = 220;
const BOX_W = 200;
const BOX_H = 120;
const BOX_X = (W - BOX_W) / 2;
const BOX_Y = 56; // top of the box
const BELT_Y = BOX_Y + BOX_H + 24;
const CONVEYOR_Y = BELT_Y - 6;

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
  // Use ref for progress so the animation loop always reads the latest value
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Pre-generate item positions for visual consistency
    const totalItems = 45;
    const itemGrid = Array.from({ length: totalItems }, (_, i) => ({
      col: Math.floor(Math.random() * 8),
      row: i,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      delay: Math.random() * 3000,
      w: 14 + Math.random() * 10,
      h: 10 + Math.random() * 6,
    }));

    let lastCompleteCheck = false;

    const draw = (timestamp: number) => {
      const t = timestamp / 1000;
      const p = progressRef.current;

      ctx.clearRect(0, 0, W, H);

      // ── Background ──
      drawBackground(ctx);

      // ── Conveyor belt ──
      drawConveyor(ctx, t);

      // ── Box (back wall + interior) ──
      drawBox(ctx, p);

      // ── Items filling the box ──
      const filledCount = Math.floor((p / 100) * totalItems);
      drawItems(ctx, itemGrid, filledCount, t, p);

      // ── Falling package particle ──
      if (p > 0 && p < 100) {
        drawFallingItem(ctx, t, p);
      }

      // ── Completion effect ──
      if (p >= 100) {
        drawTapeSeal(ctx, t);

        if (!lastCompleteCheck) {
          lastCompleteCheck = true;
        }
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
  // Warm warehouse gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#f5f2ea");
  bg.addColorStop(1, "#e8e4da");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle floor line
  ctx.fillStyle = "#d8d4ca";
  ctx.fillRect(0, CONVEYOR_Y - 2, W, 2);
}

function drawConveyor(ctx: CanvasRenderingContext2D, t: number) {
  // Belt tread
  ctx.fillStyle = "#5a5a5a";
  ctx.fillRect(40, CONVEYOR_Y, W - 80, 10);

  // Rollers
  const rollerSpacing = 36;
  const offset = (t * 40) % rollerSpacing;
  for (let x = 40 - offset; x < W - 40; x += rollerSpacing) {
    ctx.beginPath();
    ctx.arc(x, CONVEYOR_Y + 5, 7, 0, Math.PI);
    ctx.fillStyle = "#888";
    ctx.fill();
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Belt highlights (metallic sheen)
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(40, CONVEYOR_Y, W - 80, 3);

  // Shadow under box
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.ellipse(BOX_X + BOX_W / 2, BELT_Y + 4, BOX_W / 2 + 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBox(ctx: CanvasRenderingContext2D, progress: number) {
  const x = BOX_X;
  const y = BOX_Y;
  const w = BOX_W;
  const h = BOX_H;

  // ── Box interior (filled area) ──
  const fillPercent = Math.min(progress / 100, 1);
  const fillH = (h - 12) * fillPercent;

  if (fillH > 0) {
    // Gradient fill for depth
    const fillGrad = ctx.createLinearGradient(x, y + h - fillH, x, y + h);
    fillGrad.addColorStop(0, "#c7a44a");
    fillGrad.addColorStop(1, "#b8943e");
    ctx.fillStyle = fillGrad;
    ctx.fillRect(x + 6, y + h - 6 - fillH, w - 12, fillH);

    // Fill top highlight
    ctx.fillStyle = "rgba(255,255,200,0.15)";
    ctx.fillRect(x + 6, y + h - 6 - fillH, w - 12, 4);
  }

  // ── Box walls ──
  // Left wall
  ctx.fillStyle = "#c8a84a";
  ctx.fillRect(x, y + 4, 6, h - 4);
  // Right wall
  ctx.fillRect(x + w - 6, y + 4, 6, h - 4);
  // Bottom wall
  ctx.fillRect(x, y + h - 6, w, 6);

  // ── Box outline ──
  ctx.strokeStyle = "#9a7e32";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  // ── Corrugation lines ──
  ctx.strokeStyle = "rgba(154,126,50,0.2)";
  ctx.lineWidth = 1;
  for (let ly = y + 18; ly < y + h - 8; ly += 10) {
    ctx.beginPath();
    ctx.moveTo(x + 8, ly);
    for (let lx = x + 8; lx < x + w - 8; lx += 4) {
      ctx.lineTo(lx + 2, ly + 2);
      ctx.lineTo(lx + 4, ly);
    }
    ctx.stroke();
  }

  // ── Open flaps ──
  if (progress < 100) {
    // Left flap
    ctx.fillStyle = "#dbb85a";
    ctx.beginPath();
    ctx.moveTo(x - 14, y - 4);
    ctx.lineTo(x + 4, y - 14);
    ctx.lineTo(x + 4, y + 4);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#9a7e32";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Right flap
    ctx.beginPath();
    ctx.moveTo(x + w + 14, y - 4);
    ctx.lineTo(x + w - 4, y - 14);
    ctx.lineTo(x + w - 4, y + 4);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Back flap (behind)
    ctx.fillStyle = "#b8943e";
    ctx.fillRect(x + 4, y - 12, w - 8, 10);
    ctx.strokeStyle = "#9a7e32";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 4, y - 12, w - 8, 10);
  }

  // ── Box label ──
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + 40, y + 30, w - 80, 36);
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 40, y + 30, w - 80, 36);

  // Label text
  ctx.fillStyle = "#666";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TRANSLATION PACK", x + w / 2, y + 46);
  ctx.fillStyle = "#999";
  ctx.font = "8px sans-serif";
  ctx.fillText("FRAGILE", x + w / 2, y + 58);
}

function drawItems(
  ctx: CanvasRenderingContext2D,
  items: { col: number; color: string; delay: number; w: number; h: number }[],
  count: number,
  t: number,
  progress: number,
) {
  const itemStartX = BOX_X + 12;
  const itemStartY = BOX_Y + BOX_H - 12;
  const cols = 8;
  const cellW = (BOX_W - 24) / cols;

  for (let i = 0; i < Math.min(count, items.length); i++) {
    const item = items[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ix = itemStartX + col * cellW + (cellW - item.w) / 2;
    const iy = itemStartY - (row + 1) * 12 + (cellW - item.h) / 2;

    // Drop animation for most recently placed items
    let visualY = iy;
    if (i >= count - 3 && count > 1 && progress < 100) {
      const age = (t * 1000 - item.delay) % 500;
      const dropProgress = Math.min(age / 300, 1);
      visualY = iy - (1 - dropProgress) * 30 * easeOutCubic(dropProgress);
    }

    // Item
    ctx.fillStyle = item.color;
    const r = 2;
    ctx.beginPath();
    ctx.roundRect(ix, visualY, item.w, item.h, r);
    ctx.fill();

    // Item highlight
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(ix + 2, visualY + 1, item.w - 6, 2);
  }
}

function drawFallingItem(ctx: CanvasRenderingContext2D, t: number, progress: number) {
  const cycle = 1.2 + (1 - progress / 100) * 0.8;
  const phase = (t % cycle) / cycle; // 0 → 1

  const startY = 20;
  const endY = BOX_Y + BOX_H - 24;
  const itemX = BOX_X + BOX_W / 2 + Math.sin(t * 3) * 20;

  const y = startY + (endY - startY) * easeOutBounce(phase);
  const size = 12 + Math.sin(t * 5) * 2;
  const alpha = phase < 0.95 ? 1 : Math.max(0, (1 - phase) * 20);

  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS[Math.floor(t * 2) % COLORS.length];
  ctx.beginPath();
  ctx.roundRect(itemX - size / 2, y - size / 2, size, size, 2);
  ctx.fill();

  // Trail
  if (y > startY + 10) {
    ctx.fillStyle = "rgba(100,100,100,0.1)";
    ctx.fillRect(itemX - 2, y - 20, 4, 15);
  }

  ctx.globalAlpha = 1;
}

function drawTapeSeal(ctx: CanvasRenderingContext2D, t: number) {
  const x = BOX_X;
  const y = BOX_Y;
  const w = BOX_W;
  const h = BOX_H;

  // Close flaps animation (brief)
  const sealProgress = Math.min((t * 2) % 2, 1);
  const flapPhase = Math.min(sealProgress * 3, 1);

  // ── Left flap closing ──
  if (flapPhase > 0) {
    const closeY = -14 + 14 * easeOutBack(Math.min(flapPhase * 2, 1));
    ctx.fillStyle = "#dbb85a";
    ctx.beginPath();
    ctx.moveTo(x - 14 + 14 * easeOutBack(flapPhase), y - 4 + 4 * easeOutBack(flapPhase));
    ctx.lineTo(x + 4, y + closeY);
    ctx.lineTo(x + 4, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#9a7e32";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Right flap closing (delayed slightly) ──
  const rightPhase = Math.max(0, (flapPhase - 0.15) / 0.85);
  if (rightPhase > 0) {
    const closeY = -14 + 14 * easeOutBack(Math.min(rightPhase * 2, 1));
    ctx.fillStyle = "#dbb85a";
    ctx.beginPath();
    ctx.moveTo(x + w + 14 - 14 * easeOutBack(rightPhase), y - 4 + 4 * easeOutBack(rightPhase));
    ctx.lineTo(x + w - 4, y + closeY);
    ctx.lineTo(x + w - 4, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#9a7e32";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Tape strips ──
  const tapePhase = Math.max(0, (flapPhase - 0.5) / 0.5);
  if (tapePhase > 0) {
    const tapeAlpha = Math.min(tapePhase * 3, 1);

    // Center tape
    ctx.globalAlpha = tapeAlpha;
    ctx.fillStyle = "#e0dcc8";
    ctx.shadowColor = "rgba(0,0,0,0.1)";
    ctx.shadowBlur = 3;
    ctx.fillRect(x + w / 2 - 3, y - 18, 6, h + 30);
    ctx.shadowBlur = 0;

    // Left edge tape
    ctx.fillStyle = "#e0dcc8";
    ctx.fillRect(x + 6, y - 12, 4, h + 24);

    // Right edge tape
    ctx.fillRect(x + w - 10, y - 12, 4, h + 24);

    // "SEALED" stamp
    const stampPhase = Math.max(0, (tapePhase - 0.3) / 0.7);
    if (stampPhase > 0) {
      ctx.save();
      ctx.globalAlpha = stampPhase;
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(-0.15);
      ctx.fillStyle = "#c0392b";
      ctx.strokeStyle = "#c0392b";
      ctx.lineWidth = 2;
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Stamp outline
      const sw = 120;
      const sh = 32;
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.fillText("PACKED", 0, 0);
      ctx.restore();
    }

    ctx.globalAlpha = 1;
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

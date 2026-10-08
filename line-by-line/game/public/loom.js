/* The loom: every finished line weaves one weft row across the warp. */

import { reducedMotion } from "./fx.js";

const WARP = "rgba(214, 222, 255, 0.16)";
const MAX_ROWS = 48;

const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};

/** The loom panel next to the editor. */
export class Loom {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, { total, filled = 0, color }) {
    this.canvas = canvas;
    this.total = Math.max(1, total);
    this.filled = filled;
    this.color = color;
    this.anim = 1;
    this.draw();
    this.onResize = () => this.draw();
    addEventListener("resize", this.onResize);
  }

  destroy() {
    removeEventListener("resize", this.onResize);
  }

  set(filled, animate = true) {
    const before = this.rowsFor(this.filled);
    this.filled = filled;
    if (animate && !reducedMotion && this.rowsFor(filled) !== before) {
      this.anim = 0;
      const step = () => {
        this.anim = Math.min(1, this.anim + 0.08);
        this.draw();
        if (this.anim < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else this.draw();
  }

  /** Visible rows: one per line, or scaled down when a file has more lines than the loom has rows. */
  rowsFor(n) {
    const rows = Math.min(this.total, MAX_ROWS);
    return Math.round((n / this.total) * rows);
  }

  draw() {
    const { canvas } = this;
    const dpr = devicePixelRatio;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const rows = Math.min(this.total, MAX_ROWS);
    const rowH = h / rows;
    const warps = Math.max(8, Math.floor(w / 9));
    const colW = w / warps;

    ctx.strokeStyle = WARP;
    ctx.lineWidth = Math.max(1, colW * 0.28);
    for (let i = 0; i < warps; i++) {
      ctx.beginPath();
      ctx.moveTo(colW * (i + 0.5), 0);
      ctx.lineTo(colW * (i + 0.5), h);
      ctx.stroke();
    }

    const done = this.rowsFor(this.filled);
    for (let r = 0; r < done; r++) {
      const newest = r === done - 1;
      const reach = newest ? this.anim : 1;
      const y = r * rowH;
      const thick = Math.max(2, rowH * 0.78);
      for (let i = 0; i < warps; i++) {
        if (colW * i > w * reach) break;
        const over = (i + r) % 2 === 0;
        ctx.fillStyle = shade(this.color, over ? 0.06 : -0.12);
        ctx.fillRect(colW * i, y + (rowH - thick) / 2, colW + 0.5, thick);
        if (!over) {
          // the warp thread passes over the weft here
          ctx.fillStyle = "rgba(214, 222, 255, 0.35)";
          ctx.fillRect(colW * (i + 0.5) - colW * 0.14, y + (rowH - thick) / 2, colW * 0.28, thick);
        }
      }
      if (newest && reach < 1) {
        // the shuttle
        ctx.fillStyle = "#f4f6ff";
        ctx.beginPath();
        ctx.ellipse(w * reach, y + rowH / 2, 9, Math.max(3, rowH * 0.45), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/**
 * A small woven swatch as inline SVG: `bands` is [{ color, rows, filled }] stacked top to bottom.
 * Used for spools on the map, the step summary and the final tapestry.
 */
export function swatch(bands, { width = 120, height = 80, cols = 14 } = {}) {
  const totalRows = bands.reduce((n, b) => n + b.rows, 0) || 1;
  const rowH = height / totalRows;
  const colW = width / cols;
  let y = 0;
  let parts = "";
  bands.forEach((band, bi) => {
    for (let r = 0; r < band.rows; r++) {
      const woven = r < band.filled;
      for (let i = 0; i < cols; i++) {
        const over = (i + r + bi) % 2 === 0;
        const fill = woven ? shade(band.color, over ? 0.05 : -0.14) : "rgba(255,255,255,0.04)";
        parts += `<rect x="${(i * colW).toFixed(2)}" y="${y.toFixed(2)}" width="${(colW + 0.3).toFixed(2)}" height="${(rowH * 0.86).toFixed(2)}" fill="${fill}"/>`;
      }
      y += rowH;
    }
  });
  let warp = "";
  for (let i = 0; i < cols; i++) {
    warp += `<line x1="${((i + 0.5) * colW).toFixed(2)}" y1="0" x2="${((i + 0.5) * colW).toFixed(2)}" y2="${height}" stroke="rgba(214,222,255,0.14)" stroke-width="${(colW * 0.22).toFixed(2)}"/>`;
  }
  return `<svg class="swatch" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${warp}${parts}</svg>`;
}

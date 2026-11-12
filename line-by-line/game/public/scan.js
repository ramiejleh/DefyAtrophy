/*
 * Scanlines: every finished line draws one row of a picture, the way a CRT beam draws a screen. Each
 * picture is a symmetric pixel emblem grown from a seed (a file's path, a step's id), so every file and
 * every step gets its own.
 */

import { reducedMotion } from "./fx.js";

/** Columns per picture; the right half mirrors the left. */
const COLS = 16;
const MIN_ROWS = 8;
const MAX_ROWS = 24;
const ON = "#39ff7a";
const OFF = "rgba(57, 255, 122, 0.1)";

/** One row per line, within limits: tiny files still get a picture, long ones share rows between lines. */
export const rowsFor = (lines) => Math.max(MIN_ROWS, Math.min(MAX_ROWS, lines));

function random(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), h | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rows × COLS pixels, denser toward the middle, lighter on the top and bottom rows. */
export function emblem(seed, rows) {
  const rand = random(seed);
  const half = COLS / 2;
  return Array.from({ length: rows }, (_, r) => {
    const edge = r === 0 || r === rows - 1 ? 0.18 : 0;
    const left = Array.from({ length: half }, (_, c) => rand() < 0.3 + (c / half) * 0.3 - edge);
    return [...left, ...[...left].reverse()];
  });
}

/** Is pixel (r, c) drawn yet, with `lit` rows done (fractional: the beam is partway along the next one)? */
const isLit = (r, c, lit) => r < Math.floor(lit) || (r === Math.floor(lit) && c < (lit % 1) * COLS);

/**
 * A static picture as inline SVG, for the map, the step header and the summaries.
 * `lit` is how many rows are drawn; `locked` shows static instead.
 */
export function emblemSvg(seed, { rows = MIN_ROWS, lit = rows, locked = false, cell = 5 } = {}) {
  const w = COLS * cell;
  const h = rows * cell;
  let parts = "";
  if (locked) {
    const rand = random(`static:${seed}`);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < COLS; c++) {
        const a = rand() * 0.22;
        if (a > 0.06) parts += `<rect x="${c * cell}" y="${r * cell}" width="${cell - 1}" height="${cell - 1}" fill="rgba(57,255,122,${a.toFixed(2)})"/>`;
      }
  } else {
    const pic = emblem(seed, rows);
    pic.forEach((row, r) =>
      row.forEach((on, c) => {
        parts +=
          on && isLit(r, c, lit)
            ? `<rect class="px" x="${c * cell}" y="${r * cell}" width="${cell - 1}" height="${cell - 1}"/>`
            : `<rect x="${c * cell + cell / 2 - 0.75}" y="${r * cell + cell / 2 - 0.75}" width="1.5" height="1.5" fill="${OFF}"/>`;
      }),
    );
  }
  return `<svg class="emblem-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${parts}</svg>`;
}

/** The live picture next to the editor: a row per finished line, and the beam moving along as you type. */
export class Scanlines {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, { total, filled = 0, seed }) {
    this.canvas = canvas;
    this.total = Math.max(1, total);
    this.rows = rowsFor(this.total);
    this.pic = emblem(seed, this.rows);
    this.filled = filled;
    this.part = 0;
    this.shown = this.target();
    this.onResize = () => this.draw();
    addEventListener("resize", this.onResize);
    this.draw();
  }

  destroy() {
    removeEventListener("resize", this.onResize);
    cancelAnimationFrame(this.raf);
  }

  /** Rows drawn so far, fractional while a line is partway typed. */
  target() {
    return Math.min(this.rows, ((this.filled + this.part) / this.total) * this.rows);
  }

  /** How far through the current line the typing is, 0 to 1. */
  partial(fraction) {
    const part = Math.max(0, Math.min(0.999, fraction));
    // unchanged (e.g. a fresh line right after a row was finished): let the sweep animation run
    if (part === this.part) return;
    this.part = part;
    cancelAnimationFrame(this.raf);
    this.shown = this.target();
    this.draw();
  }

  set(filled, animate = true) {
    this.filled = filled;
    this.part = 0;
    const goal = this.target();
    cancelAnimationFrame(this.raf);
    if (!animate || reducedMotion || goal <= this.shown) {
      this.shown = goal;
      return this.draw();
    }
    // the beam sweeps the rest of the row in quickly
    const step = () => {
      this.shown = Math.min(goal, this.shown + Math.max(0.04, (goal - this.shown) * 0.25));
      this.draw();
      if (this.shown < goal) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  draw() {
    const { canvas, rows } = this;
    const dpr = devicePixelRatio;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const cell = Math.floor(Math.min(w / COLS, h / rows));
    const ox = Math.round((w - cell * COLS) / 2);
    const oy = Math.round((h - cell * rows) / 2);
    const lit = this.shown;
    const gap = cell > 5 ? 1 : 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = ox + c * cell;
        const y = oy + r * cell;
        if (this.pic[r][c] && isLit(r, c, lit)) {
          ctx.shadowColor = ON;
          ctx.shadowBlur = cell * 0.9;
          ctx.fillStyle = ON;
          ctx.fillRect(x + gap, y + gap, cell - gap * 2, cell - gap * 2);
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = OFF;
          ctx.fillRect(x + cell / 2 - 1, y + cell / 2 - 1, 2, 2);
        }
      }
    }

    if (lit < rows) {
      // the beam: a faint band on the row being drawn and a bright point where it is
      const r = Math.floor(lit);
      const bx = ox + (lit % 1) * COLS * cell;
      ctx.fillStyle = "rgba(57, 255, 122, 0.1)";
      ctx.fillRect(ox, oy + r * cell, cell * COLS, cell);
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#eafff0";
      ctx.fillRect(bx - 1, oy + r * cell, 3, cell);
      ctx.shadowBlur = 0;
    }
  }
}

/* Visual and sound effects: the CRT's slow refresh band, pixel sparks, falling pixels, tones. */

export const PHOSPHOR = ["#39ff7a", "#39ff7a", "#9cfcc6", "#eafff0", "#ffb000"];

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A faint bright band rolling down the screen, like a CRT's refresh. */
export function startBackground(canvas) {
  const ctx = canvas.getContext("2d");
  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
  };
  resize();
  addEventListener("resize", resize);
  if (reducedMotion) return;

  const PERIOD = 9000;
  const draw = (t) => {
    const { width: w, height: h } = canvas;
    const band = h * 0.22;
    const y = ((t % PERIOD) / PERIOD) * (h + band * 2) - band;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, y - band, 0, y + band);
    g.addColorStop(0, "rgba(57, 255, 122, 0)");
    g.addColorStop(0.5, "rgba(57, 255, 122, 0.035)");
    g.addColorStop(1, "rgba(57, 255, 122, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y - band, w, band * 2);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

const particles = [];
let fxCtx;
let running = false;

export function initFx(canvas) {
  fxCtx = canvas.getContext("2d");
  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
  };
  resize();
  addEventListener("resize", resize);
}

function loop() {
  const ctx = fxCtx;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= 1;
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx;
    p.y += p.vy;
    if (p.life <= 0 || p.y > ctx.canvas.height + 40) {
      particles.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.size;
    ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
    ctx.restore();
  }
  if (particles.length) requestAnimationFrame(loop);
  else running = false;
}

function kick() {
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

/** A small burst of pixel sparks at a screen position. */
export function burst(x, y, { count = 18, power = 1, colors = PHOSPHOR } = {}) {
  if (reducedMotion || !fxCtx) return;
  const d = devicePixelRatio;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (2 + Math.random() * 5) * power * d;
    particles.push({
      x: x * d,
      y: y * d,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2 * d,
      gravity: 0.22 * d,
      drag: 0.96,
      size: Math.round((2 + Math.random() * 3) * d),
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 50 + Math.random() * 30,
    });
  }
  kick();
}

/** Full-screen fall of glowing pixels. */
export function confetti(amount = 160) {
  if (reducedMotion || !fxCtx) return;
  const d = devicePixelRatio;
  const w = fxCtx.canvas.width;
  for (let i = 0; i < amount; i++) {
    particles.push({
      x: Math.random() * w,
      y: -Math.random() * 300 * d,
      vx: (Math.random() - 0.5) * 3 * d,
      vy: (1 + Math.random() * 3) * d,
      gravity: 0.05 * d,
      drag: 0.995,
      size: Math.round((3 + Math.random() * 4) * d),
      color: PHOSPHOR[i % PHOSPHOR.length],
      life: 260 + Math.random() * 120,
    });
  }
  kick();
}

/** Floating "+12 XP" style label. */
export function floatText(x, y, text, color = "var(--accent)") {
  const el = document.createElement("div");
  el.className = "float-text";
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = color;
  document.body.append(el);
  el.addEventListener("animationend", () => el.remove());
}

let audio;
export const sound = { enabled: false };

function tone(freq, duration, { type = "sine", volume = 0.05, slide = 0 } = {}) {
  if (!sound.enabled) return;
  audio ??= new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const t = audio.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + duration);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration);
}

export const sfx = {
  key: () => tone(1800 + Math.random() * 400, 0.025, { type: "square", volume: 0.012 }),
  error: () => tone(160, 0.12, { type: "sawtooth", volume: 0.03, slide: 0.7 }),
  line: (combo) => tone(520 + Math.min(combo, 12) * 40, 0.14, { type: "triangle", volume: 0.05, slide: 1.5 }),
  file: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.2, { type: "triangle" }), i * 90)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, { type: "triangle" }), i * 120)),
};

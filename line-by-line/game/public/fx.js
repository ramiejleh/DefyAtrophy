/* Visual and sound effects: drifting background glow, thread sparks, falling thread snippets, tones. */

export const THREAD_COLORS = ["#7c8cff", "#2ec4b6", "#ff7a6b", "#f4b942", "#c77dff", "#5ab8ff", "#ff6f91", "#8bd17c"];

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Slowly drifting coloured glow behind everything. */
export function startBackground(canvas) {
  const ctx = canvas.getContext("2d");
  const blobs = Array.from({ length: 12 }, (_, i) => ({
    x: Math.random(),
    y: Math.random(),
    r: 140 + Math.random() * 220,
    vx: (Math.random() - 0.5) * 0.0001,
    vy: (Math.random() - 0.5) * 0.0001,
    color: THREAD_COLORS[i % THREAD_COLORS.length],
  }));
  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
  };
  resize();
  addEventListener("resize", resize);

  const draw = () => {
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (const b of blobs) {
      b.x = (b.x + b.vx + 1) % 1;
      b.y = (b.y + b.vy + 1) % 1;
      const r = b.r * devicePixelRatio;
      const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, r);
      g.addColorStop(0, b.color + "1c");
      g.addColorStop(1, b.color + "00");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x * w, b.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reducedMotion) requestAnimationFrame(draw);
  };
  draw();
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
    p.rot += p.vr;
    if (p.life <= 0 || p.y > ctx.canvas.height + 40) {
      particles.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.strokeStyle = p.color;
    ctx.fillStyle = p.color;
    if (p.shape === "thread") {
      // A short curled length of thread.
      ctx.lineWidth = Math.max(1.5, p.size / 3);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-p.size, 0);
      ctx.bezierCurveTo(-p.size / 3, -p.size * p.curl, p.size / 3, p.size * p.curl, p.size, 0);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2);
      ctx.fill();
    }
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

/** A small burst of thread sparks at a screen position. */
export function burst(x, y, { count = 18, power = 1, colors = THREAD_COLORS } = {}) {
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
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.3,
      size: (4 + Math.random() * 5) * d,
      curl: 0.4 + Math.random() * 0.8,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 50 + Math.random() * 30,
      shape: Math.random() < 0.65 ? "thread" : "dot",
    });
  }
  kick();
}

/** Full-screen fall of loose thread snippets. */
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
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.15,
      size: (6 + Math.random() * 8) * d,
      curl: 0.3 + Math.random(),
      color: THREAD_COLORS[i % THREAD_COLORS.length],
      life: 260 + Math.random() * 120,
      shape: "thread",
    });
  }
  kick();
}

/** Floating "+12 XP" style label. */
export function floatText(x, y, text, color = "#2ec4b6") {
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

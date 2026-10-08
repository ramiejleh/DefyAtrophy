/* Level 2: one step's files drawn where they live in the project, with a suggested order and import arrows. */

import { go } from "../app.js";
import { burst, confetti, sfx } from "../fx.js";
import { fileSize, fileStatus, mode, nextSuggested, saveProgress, stepFilesDone, stepNumber, stepPercent, stepStatus, store, walkthrough } from "../store.js";
import { buildTree } from "../tree.js";
import { api, esc, fileName, md, mdInline, toast } from "../util.js";
import { spool } from "./map.js";

let resizeObserver;
let shownStepId = null;

const STATUS = {
  todo: ["", "Not started"],
  progress: ["◐", "In progress"],
  done: ["✓", "Done"],
  conflict: ["!", "Changed on disk"],
  grading: ["…", "Grading"],
  pass: ["✓", "Passed"],
  partial: ["~", "Almost there"],
  retry: ["↺", "Needs another go"],
};
const ACTION = { create: ["new", "New"], modify: ["modified", "Modified"], delete: ["deleted", "Deleted"], read: ["existing", ""] };

const projectName = () => store.session.projectDir.split(/[\\/]/).filter(Boolean).pop() ?? "project";

export function render({ stepId }) {
  shownStepId = stepId;
  const step = store.session.steps.find((s) => s.id === stepId);
  const i = store.session.steps.indexOf(step);
  const status = stepStatus(step);
  const pct = stepPercent(step);
  const files = step.files;
  const context = step.diagram?.context ?? [];
  const tree = buildTree([...files.map((f) => ({ ...f, kind: "file" })), ...context.map((c) => ({ ...c, kind: "context" }))]);
  const next = nextSuggested(step);
  const removedFiles = files.filter((f) => f.action === "delete");

  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="screen">
      <div class="stepview">
        <header class="step-head">
          <button class="btn ghost small" data-back>← All steps</button>
          <div class="step-title">
            ${spool(i, status)}
            <div><p class="eyebrow">Step ${i + 1} of ${store.session.steps.length}</p><h1>${esc(step.title)}</h1><p class="tagline">${esc(step.tagline ?? "")}</p></div>
          </div>
          <div class="step-progress"><div class="bar"><i style="width:${pct}%"></i></div><span>${pct}%</span></div>
        </header>
        <div class="step-grid">
          <section class="diagram-card glass" aria-label="Where the files live">
            <div class="diagram-head">
              <h2>Where these files live</h2>
              <div class="legend">
                <span><i class="order-dot">1</i> suggested order</span>
                ${walkthrough() ? "" : `<span><i class="badge new">new</i></span><span><i class="badge modified">modified</i></span><span><i class="badge deleted">deleted</i></span>`}
                <span><i class="ctx-dot"></i> context</span>
              </div>
            </div>
            <div class="diagram" id="diagram">
              <svg class="edges" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs></svg>
              ${folderHtml({ ...tree, name: projectName() }, true)}
              <div class="edge-labels" aria-hidden="true"></div>
            </div>
            <p class="diagram-hint">${next ? `Suggested next: <b>${next.order}. ${esc(fileName(next.path))}</b>. Any file can be opened in any order.` : "Every file in this step is done. Open any of them to read it again."}</p>
          </section>
          <aside class="step-side">
            <section class="glass brief">
              <h3>Goal</h3>
              <div class="goal">${md(step.goal ?? "")}</div>
              ${step.concepts?.length ? `<h3>You'll meet</h3><div class="chips">${step.concepts.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
              ${
                step.setup?.length
                  ? `<h3>Before you start</h3><ul class="checklist">${step.setup
                      .map((s, k) => `<li><label><input type="checkbox" data-setup="${k}" ${store.progress.steps[step.id]?.setup?.[k] ? "checked" : ""}/> <span>${mdInline(s)}</span></label></li>`)
                      .join("")}</ul>`
                  : ""
              }
              ${alsoHtml(step, removedFiles)}
            </section>
            <section class="glass order-list">
              <h3>Files</h3>
              <ol>${[...files]
                .sort((a, b) => a.order - b.order)
                .map((f) => {
                  const st = fileStatus(f);
                  return `<li><button data-open="${esc(f.path)}" class="${st}"><span class="order-dot">${f.order}</span><span class="name">${esc(f.path)}</span><span class="st" title="${STATUS[st][1]}">${STATUS[st][0] || ""}</span></button></li>`;
                })
                .join("")}</ol>
            </section>
            ${
              stepFilesDone(step) && mode() !== "review"
                ? `<button class="btn" data-summary>${mode() === "type" && !store.state.reflections[step.id] ? "Write your reflection →" : "Step summary →"}</button>`
                : stepFilesDone(step)
                  ? `<button class="btn" data-summary>Step ${walkthrough() ? "read" : "reviewed"}. Continue →</button>`
                  : ""
            }
          </aside>
        </div>
      </div>
    </div>`;

  app.querySelector("[data-back]").addEventListener("click", () => go("map"));
  app.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => openFile(el.dataset.open)));
  app.querySelector("[data-summary]")?.addEventListener("click", () => go("done", { stepId: step.id }));
  app.querySelectorAll("[data-setup]").forEach((el) =>
    el.addEventListener("change", () => {
      store.progress.steps[step.id] ??= {};
      store.progress.steps[step.id].setup ??= {};
      store.progress.steps[step.id].setup[el.dataset.setup] = el.checked;
      saveProgress();
    }),
  );

  const diagram = document.getElementById("diagram");
  resizeObserver = new ResizeObserver(() => drawEdges(step));
  resizeObserver.observe(diagram);
  requestAnimationFrame(() => drawEdges(step));
  (app.querySelector(`.card[data-open="${CSS.escape(next?.path ?? "")}"]`) ?? app.querySelector("[data-back]")).focus({ preventScroll: true });
}

export function leave() {
  resizeObserver?.disconnect();
}

export function onState({ changedFiles }) {
  if (changedFiles.length && shownStepId) render({ stepId: shownStepId });
}

function openFile(path) {
  go(mode() === "learn" ? "learn" : "file", { path });
}

function alsoHtml(step, removedFiles) {
  const auto = step.autoApplied ?? [];
  if (!auto.length && !removedFiles.length) return "";
  const verb = mode() === "review" ? "Also changed (not shown line by line)" : "Also applied when this step is done";
  return `
    <h3>${verb}</h3>
    <ul class="also">
      ${auto.map((a) => `<li><code>${esc(a.path)}</code><span>${a.action === "delete" ? "deleted" : "updated"} · ${esc(a.reason)}</span></li>`).join("")}
      ${removedFiles.map((f) => `<li><code>${esc(f.path)}</code><span>deleted${mode() === "review" ? "" : ": you'll confirm it"}</span></li>`).join("")}
    </ul>`;
}

function folderHtml(node, root = false) {
  const files = node.files.map(cardHtml).join("");
  const dirs = node.dirs.map((d) => folderHtml(d)).join("");
  return `
    <div class="folder ${root ? "root" : ""}">
      <div class="folder-label"><span aria-hidden="true">▸</span> ${esc(node.name)}/</div>
      <div class="folder-body">${files}${dirs}</div>
    </div>`;
}

function cardHtml(entry) {
  if (entry.kind === "context") {
    return `<div class="card context" data-node="${esc(entry.path)}" title="${esc(entry.path)}">
      <span class="card-name">${esc(entry.name)}</span><span class="card-role">${esc(entry.note ?? "")}</span></div>`;
  }
  const st = fileStatus(entry);
  const [actionCls, actionText] = ACTION[entry.action];
  const size = fileSize(entry);
  const unit = mode() === "learn" ? (size === 1 ? "part" : "parts") : size === 1 ? "line" : "lines";
  const fp = store.progress.files[entry.path];
  const pct = st === "done" ? 100 : mode() === "learn" ? 0 : Math.round(((fp?.cursor ?? 0) / Math.max(1, size)) * 100);
  return `
    <button class="card ${st} ${actionCls}" data-node="${esc(entry.path)}" data-open="${esc(entry.path)}"
      aria-label="${entry.order}. ${esc(entry.path)}, ${actionText ? `${actionText.toLowerCase()}, ` : ""}${STATUS[st][1].toLowerCase()}">
      <span class="order-dot">${entry.order}</span>
      <span class="card-top"><span class="card-name">${esc(entry.name)}</span>${actionText ? `<span class="badge ${actionCls}">${actionText}</span>` : ""}</span>
      <span class="card-role">${esc(entry.role ?? "")}</span>
      <span class="card-meta"><span>${STATUS[st][0] ? `${STATUS[st][0]} ` : ""}${STATUS[st][1]}</span><span>${size} ${unit}</span></span>
      <span class="card-bar"><i style="width:${pct}%"></i></span>
    </button>`;
}

/** Arrows between cards, clipped to the card edges, redrawn whenever the layout changes. */
function drawEdges(step) {
  const diagram = document.getElementById("diagram");
  const svg = diagram?.querySelector("svg.edges");
  if (!svg) return;
  svg.querySelectorAll("g.edge").forEach((g) => g.remove());
  const labels = diagram.querySelector(".edge-labels");
  labels.innerHTML = "";
  const box = diagram.getBoundingClientRect();
  svg.setAttribute("width", diagram.scrollWidth);
  svg.setAttribute("height", diagram.scrollHeight);
  const rectOf = (path) => {
    const el = diagram.querySelector(`[data-node="${CSS.escape(path)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - box.left + diagram.scrollLeft, y: r.top - box.top + diagram.scrollTop, w: r.width, h: r.height };
  };
  const clip = (r, tx, ty) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    const scale = 1 / Math.max(Math.abs(dx) / (r.w / 2 + 4), Math.abs(dy) / (r.h / 2 + 4), 1e-6);
    return [cx + dx * scale, cy + dy * scale];
  };
  for (const edge of step.diagram?.edges ?? []) {
    const a = rectOf(edge.from);
    const b = rectOf(edge.to);
    if (!a || !b || edge.from === edge.to) continue;
    const [x1, y1] = clip(a, b.x + b.w / 2, b.y + b.h / 2);
    const [x2, y2] = clip(b, a.x + a.w / 2, a.y + a.h / 2);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const bend = Math.min(40, len * 0.18);
    const qx = mx - ((y2 - y1) / len) * bend;
    const qy = my + ((x2 - x1) / len) * bend;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "edge");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`);
    p.setAttribute("marker-end", "url(#arrow)");
    g.append(p);
    if (edge.label) {
      const t = document.createElement("span");
      t.className = "edge-label";
      // a third of the way along the curve, in the gap next to the source card
      const at = 0.3;
      t.style.left = `${(1 - at) ** 2 * x1 + 2 * (1 - at) * at * qx + at ** 2 * x2}px`;
      t.style.top = `${(1 - at) ** 2 * y1 + 2 * (1 - at) * at * qy + at ** 2 * y2}px`;
      t.textContent = edge.label;
      labels.append(t);
    }
    svg.append(g);
  }
}

/**
 * Called when a file finishes. Once every file in the step is done, applies the step's untyped changes
 * (lockfiles, binaries) and moves on to the step summary.
 */
export async function finishFile(path) {
  const step = store.session.steps.find((s) => s.files.some((f) => f.path === path));
  if (!stepFilesDone(step)) {
    go("step", { stepId: step.id });
    return;
  }
  if (mode() !== "review" && !store.progress.steps[step.id]?.applied) {
    try {
      const { results } = await api.post("/api/step-done", { stepId: step.id });
      const failed = results.filter((r) => !r.ok);
      if (failed.length) toast(`Couldn't apply ${failed.map((f) => `<code>${esc(f.path)}</code> (${esc(f.reason)})`).join(", ")}`, "!");
      store.progress.steps[step.id] = { ...store.progress.steps[step.id], applied: true };
    } catch (error) {
      toast(`Couldn't finish the step: ${esc(error.message)}`, "!");
    }
  }
  store.progress.steps[step.id] = { ...store.progress.steps[step.id], doneAt: store.progress.steps[step.id]?.doneAt ?? new Date().toISOString() };
  await saveProgress(true);
  sfx.win();
  confetti();
  burst(innerWidth / 2, innerHeight / 2, { count: 60, power: 1.6 });
  toast(`Step ${stepNumber(step)} done`, "✓");
  go("done", { stepId: step.id });
}

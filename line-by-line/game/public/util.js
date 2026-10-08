/* Shared helpers: API client, escaping, tiny markdown, toasts, and the client copy of the session model. */

const token = (() => {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("t");
  try {
    if (fromHash) sessionStorage.setItem("lbl-token", fromHash);
    return fromHash ?? sessionStorage.getItem("lbl-token") ?? "";
  } catch {
    return fromHash ?? "";
  }
})();

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-LBL-Token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
};

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Tiny markdown: paragraphs, bullet lists, `code` and **bold**. Input is escaped first. */
export function md(text) {
  const inline = (s) => s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  return esc(String(text ?? "").trim())
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*] /.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${inline(lines.join("<br>"))}</p>`;
    })
    .join("");
}

export const mdInline = (text) => md(text).replace(/^<p>|<\/p>$/g, "");

export function toast(html, icon = "✓") {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span>${html}</span>`;
  document.getElementById("toasts").append(el);
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove());
  }, 3600);
}

/** Opens a modal dialog. `actions` maps data-act values to handlers; return false to keep it open. */
export function modal(html, actions = {}, { className = "", onClose } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true">${html}</div>`;
  const previous = document.activeElement;
  document.body.append(overlay);
  const close = () => {
    overlay.remove();
    onClose?.();
    if (previous?.isConnected) previous.focus?.({ preventScroll: true });
  };
  overlay.addEventListener("click", async (e) => {
    if (e.target === overlay) return close();
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "close") return close();
    const keep = await actions[act]?.(e);
    if (keep !== false) close();
  });
  overlay.addEventListener("keydown", (e) => e.key === "Escape" && close());
  (overlay.querySelector("[autofocus]") ?? overlay.querySelector(".btn:not(.ghost)") ?? overlay.querySelector("button"))?.focus({ preventScroll: true });
  return { overlay, close };
}

/* ---------- session model (mirrors lib/session.js) ---------- */

/** Every line of a file in display order, tagged with its kind and line numbers. */
export function rowsOf(file) {
  if (file._rows) return file._rows;
  const out = [];
  let newNo = 0;
  let oldNo = 0;
  file.segments.forEach((seg, segIdx) => {
    if (seg.kind === "hole") {
      out.push({ kind: "hole", id: seg.id, spec: seg.spec, indent: seg.indent, lineCount: seg.lineCount, segIdx });
      return;
    }
    for (const line of seg.lines) {
      if (seg.kind === "removed") out.push({ kind: "removed", ...line, oldNo: ++oldNo, segIdx });
      else if (seg.kind === "typed") out.push({ kind: "typed", ...line, newNo: ++newNo, segIdx });
      else {
        oldNo++;
        out.push({ kind: "given", ...line, newNo: ++newNo, segIdx });
      }
    }
  });
  Object.defineProperty(file, "_rows", { value: out, enumerable: false });
  return out;
}

/** Row indexes the user moves through: non-blank typed lines, plus removed lines in review mode. */
export function stopsOf(file, mode) {
  return rowsOf(file)
    .map((r, i) => ((r.kind === "typed" && r.text !== "") || (mode === "review" && r.kind === "removed" && r.text !== "") ? i : -1))
    .filter((i) => i !== -1);
}

export const holesOf = (file) => file.segments.filter((s) => s.kind === "hole");

export const fileName = (path) => path.split("/").pop();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

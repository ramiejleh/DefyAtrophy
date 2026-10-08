import { initFx, sound, startBackground } from "./fx.js";
import { load, mode, refresh, store } from "./store.js";
import { esc, toast } from "./util.js";
import * as map from "./views/map.js";
import * as step from "./views/step.js";
import * as file from "./views/file.js";
import * as learn from "./views/learn.js";
import * as done from "./views/done.js";

const VIEWS = { map, step, file, learn, done };
const POLL_MS = 3000;

let current = null;

/** Switches screens. Views export render(params) and, optionally, leave() and onState(changes). */
export function go(name, params = {}) {
  current?.view.leave?.();
  const view = VIEWS[name];
  current = { name, view, params };
  document.getElementById("app").scrollTop = 0;
  view.render(params);
}

export const screen = () => current?.name;

function renderBanner() {
  const el = document.getElementById("banner");
  const conflicts = store.state.conflicts ?? [];
  if (!conflicts.length || mode() === "review") {
    el.innerHTML = "";
    el.className = "";
    return;
  }
  el.className = "show";
  el.innerHTML = `<span aria-hidden="true">⚠</span><span><b>${conflicts.length} file${conflicts.length > 1 ? "s" : ""} changed on disk</b> since this session was built: ${conflicts
    .slice(0, 3)
    .map((p) => `<code>${esc(p)}</code>`)
    .join(", ")}${conflicts.length > 3 ? "…" : ""}. You'll be asked before anything is overwritten.</span>`;
}

async function poll() {
  try {
    const changes = await refresh();
    renderBanner();
    if (current?.view.onState) current.view.onState(changes);
  } catch {}
}

async function boot() {
  startBackground(document.getElementById("bg"));
  initFx(document.getElementById("fx"));
  await load();
  sound.enabled = Boolean(store.progress.sound);
  document.title = `${store.session.title} · Line by Line`;
  renderBanner();
  go("map");
  setInterval(poll, POLL_MS);
}

boot().catch((error) => {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="empty glass"><h2>Couldn't start Line by Line</h2><p>${esc(error.message)}</p>
    <p>If you opened this page by hand, use the link Claude printed instead: it carries the session token.</p></div>`;
});

addEventListener("unhandledrejection", (e) => {
  toast(esc(e.reason?.message ?? "Something went wrong"), "!");
});

/* Session data, server state and the player's progress, plus the status rules for each mode. */

import { api, holesOf, stopsOf, toast } from "./util.js";

export const store = { session: null, state: null, progress: null };

export const XP_PER_LEVEL = 1500;

export const emptyStats = () => ({ correct: 0, errors: 0, activeMs: 0, lines: 0, cleanLines: 0, bestCombo: 0, xp: 0, assisted: 0 });

export const mode = () => store.session.mode;

export async function load() {
  const [session, state] = await Promise.all([api.get("/api/session"), api.get("/api/state")]);
  store.session = session;
  store.state = state;
  store.progress = { xp: 0, sound: false, blind: false, files: {}, steps: {}, ...state.progress };
}

/** Re-reads server state. Returns the paths and step ids whose grades changed. */
export async function refresh() {
  const next = await api.get("/api/state");
  const prev = store.state;
  const changedSteps = Object.keys(next.stepGrades).filter((id) => JSON.stringify(next.stepGrades[id]) !== JSON.stringify(prev.stepGrades[id]));
  const changedFiles = Object.keys(next.files).filter(
    (p) => JSON.stringify(next.files[p].grades) !== JSON.stringify(prev.files[p]?.grades) || JSON.stringify(next.files[p].hints) !== JSON.stringify(prev.files[p]?.hints),
  );
  store.state = next;
  return { changedSteps, changedFiles };
}

let saveTimer;
export function saveProgress(now = false) {
  clearTimeout(saveTimer);
  const doSave = () => api.put("/api/progress", store.progress).catch(() => toast("Couldn't save progress", "!"));
  if (now) return doSave();
  saveTimer = setTimeout(doSave, 400);
}

export function fileProgress(path) {
  store.progress.files[path] ??= { cursor: 0, done: false, stats: emptyStats() };
  return store.progress.files[path];
}

export const allFiles = () => store.session.steps.flatMap((s) => s.files);
export const stepOf = (path) => store.session.steps.find((s) => s.files.some((f) => f.path === path));
export const stepNumber = (step) => store.session.steps.indexOf(step) + 1;
export const isApplied = (path) => path in store.state.applied;

/** The lines a file asks of the user: typed lines, holes, or (review) every changed line. */
export function fileSize(file) {
  if (mode() === "learn") return holesOf(file).length;
  return stopsOf(file, mode()).length;
}

export function latestGrade(path) {
  const info = store.state.files[path];
  if (!info?.latest) return null;
  return info.grades.find((g) => g.attempt === info.latest.n) ?? null;
}

/** todo | progress | done | conflict (type) | grading | pass | partial | retry (learn) */
export function fileStatus(file) {
  const fp = store.progress.files[file.path];
  if (mode() === "review") return fp?.done ? "done" : fp?.cursor > 0 ? "progress" : "todo";
  if (isApplied(file.path)) return "done";
  if (mode() === "type") {
    if (fp?.done) return "conflict";
    return fp?.cursor > 0 ? "progress" : "todo";
  }
  const info = store.state.files[file.path];
  if (info?.latest) {
    const grade = latestGrade(file.path);
    return grade ? grade.verdict : "grading";
  }
  return fp?.draft ? "progress" : "todo";
}

export const fileDone = (file) => fileStatus(file) === "done";

export function stepFilesDone(step) {
  return step.files.every(fileDone);
}

/** locked | available | progress | typed | submitted | graded | done */
export function stepStatus(step) {
  const i = store.session.steps.indexOf(step);
  const prev = store.session.steps[i - 1];
  const started = step.files.some((f) => fileStatus(f) !== "todo");
  if (mode() === "review") return stepFilesDone(step) ? "done" : started ? "progress" : "available";
  if (mode() === "learn") {
    if (prev && !stepFilesDone(prev)) return "locked";
    return stepFilesDone(step) ? "done" : started ? "progress" : "available";
  }
  if (prev && !store.state.reflections[prev.id]) return "locked";
  if (store.state.stepGrades[step.id]) return "graded";
  if (store.state.reflections[step.id]) return "submitted";
  if (stepFilesDone(step)) return "typed";
  return started ? "progress" : "available";
}

export function stepPercent(step) {
  const total = step.files.reduce((n, f) => n + Math.max(1, fileSize(f)), 0);
  let done = 0;
  for (const f of step.files) {
    const size = Math.max(1, fileSize(f));
    if (fileDone(f)) done += size;
    else if (mode() !== "learn") done += Math.min(size, store.progress.files[f.path]?.cursor ?? 0);
  }
  return total ? Math.round((done / total) * 100) : 0;
}

export function stepStats(step) {
  const s = emptyStats();
  for (const f of step.files) {
    const fs = store.progress.files[f.path]?.stats;
    if (!fs) continue;
    for (const k of Object.keys(s)) s[k] = k === "bestCombo" ? Math.max(s[k], fs[k] ?? 0) : s[k] + (fs[k] ?? 0);
  }
  return s;
}

export function computeStats(s) {
  const minutes = s.activeMs / 60000;
  return {
    wpm: minutes > 0.05 ? Math.round(s.correct / 5 / minutes) : 0,
    accuracy: s.correct + s.errors ? Math.round((s.correct / (s.correct + s.errors)) * 100) : 100,
  };
}

export function sessionDone() {
  if (mode() === "review") return store.session.steps.every(stepFilesDone);
  return store.state.complete;
}

/** The suggested next file in a step: the lowest-numbered one that isn't done. */
export const nextSuggested = (step) => [...step.files].sort((a, b) => a.order - b.order).find((f) => !fileDone(f));

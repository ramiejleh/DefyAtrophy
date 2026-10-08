import { existsSync } from "node:fs";
import { join } from "node:path";
import { dirSource, sourceFrom } from "./sources.js";
import { CAPS, MODES, loadSession, readJson, rebuild, rows, sha256 } from "./session.js";

const STEP_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Checks a session against the solution it was built from.
 * Errors make the session unusable; warnings are worth fixing but don't block serving it.
 */
export function validate(dir) {
  const errors = [];
  const warnings = [];
  let session;
  try {
    session = loadSession(dir);
  } catch (error) {
    return { errors: [error.message], warnings };
  }
  const { mode } = session;
  if (!MODES.includes(mode)) errors.push(`unknown mode "${mode}"`);
  if (!session.steps?.length) errors.push("the session has no steps");
  const target = sourceFrom(session.source, session.projectDir);
  const project = dirSource(session.projectDir);
  const reference = mode === "learn" ? readJson(join(dir, "private", "reference.json"), {}) : {};

  const stepIds = new Set();
  const seenPaths = new Map();
  let typed = 0;
  let holes = 0;
  for (const step of session.steps ?? []) {
    if (!STEP_ID.test(step.id ?? "")) errors.push(`step id "${step.id}" must be lowercase letters, digits and dashes`);
    if (stepIds.has(step.id)) errors.push(`step id ${step.id} is used twice`);
    stepIds.add(step.id);
    if (!step.title) errors.push(`step ${step.id} has no title`);
    if (!step.files?.length && !step.autoApplied?.length) errors.push(`step ${step.id} has no files`);
    if (mode === "type" && !step.reflectionPrompt) warnings.push(`step ${step.id} has no reflectionPrompt`);

    const orders = new Set();
    for (const file of step.files ?? []) {
      if (seenPaths.has(file.path)) errors.push(`${file.path} is in both ${seenPaths.get(file.path)} and ${step.id}`);
      seenPaths.set(file.path, step.id);
      if (!Number.isInteger(file.order) || file.order < 1) errors.push(`${file.path}: order must be a positive integer`);
      if (orders.has(file.order)) errors.push(`step ${step.id}: order ${file.order} is used twice`);
      orders.add(file.order);
      if (!file.role) warnings.push(`${file.path} has no role (the one-liner on its diagram card)`);
      checkFile(file, { mode, target, project, reference, errors, warnings });
      for (const r of rows(file)) {
        if (r.kind === "typed" && r.text) typed++;
        if (r.kind === "hole") holes++;
      }
    }

    const known = new Set((step.files ?? []).map((f) => f.path));
    for (const c of step.diagram?.context ?? []) {
      if (!project.read(c.path) && !target.read(c.path)) errors.push(`step ${step.id}: diagram context ${c.path} doesn't exist`);
      known.add(c.path);
    }
    for (const e of step.diagram?.edges ?? []) {
      for (const end of [e.from, e.to]) {
        if (!known.has(end)) errors.push(`step ${step.id}: diagram edge end ${end} is neither a step file nor a context file`);
      }
    }
  }

  const draft = readJson(join(dir, "draft.json"), null);
  if (draft) {
    for (const f of draft.files) if (!seenPaths.has(f.path)) errors.push(`${f.path} changed but isn't in any step`);
  }

  const cap = CAPS[mode];
  if (mode === "learn" ? holes > cap : typed > cap) {
    errors.push(`${mode === "learn" ? holes + " holes" : typed + " lines"} is over the ${cap} cap. Split the task into smaller sessions.`);
  }
  if (mode === "learn" && existsSync(join(dir, "private")) && !existsSync(join(dir, "private", "rubric.json"))) {
    warnings.push("private/rubric.json is missing: grading will only have the specs to go on");
  }
  if (mode === "type" && !existsSync(join(dir, "private", "rubric.json"))) {
    warnings.push("private/rubric.json is missing: grading will only have the reflection prompts to go on");
  }
  return { errors, warnings, stats: { steps: session.steps?.length ?? 0, files: seenPaths.size, typed, holes } };
}

function checkFile(file, { mode, target, project, reference, errors, warnings }) {
  const expected = target.read(file.path);
  if (file.action === "delete") {
    if (expected) errors.push(`${file.path}: marked delete, but it still exists in the solution`);
  } else if (!expected) {
    errors.push(`${file.path}: missing from the solution`);
  } else {
    if (file.targetHash && sha256(expected) !== file.targetHash) errors.push(`${file.path}: the solution changed after the session was built. Rebuild it.`);
    const rebuilt = rebuild(file, (id) => reference[id]);
    if (rebuilt !== expected.toString("utf8")) errors.push(`${file.path}: rebuilding the file doesn't give the solution byte for byte`);
  }

  if (mode !== "review") {
    const onDisk = project.read(file.path);
    const hash = onDisk ? sha256(onDisk) : null;
    if (hash !== (file.baseHash ?? null)) errors.push(`${file.path}: changed in the project since the session was built`);
  }

  const all = rows(file);
  if (mode === "type" || mode === "review") {
    const missing = all.filter((r) => r.kind === "typed" && r.text && !r.note).map((r) => r.newNo);
    if (missing.length) errors.push(`${file.path}: no note for line${missing.length > 1 ? "s" : ""} ${compress(missing)}`);
  }
  if (mode === "review") {
    for (const seg of segmentsOf(file, "removed")) {
      const first = seg.lines.find((l) => l.text);
      if (first && !seg.lines.some((l) => l.note)) warnings.push(`${file.path}: a removed block starting "${first.text.slice(0, 40)}" has no note`);
    }
  }
  if (mode === "learn") {
    for (const seg of segmentsOf(file, "hole")) {
      if (!seg.spec) errors.push(`${file.path}: hole ${seg.id} has no spec`);
      if (!(seg.id in reference)) errors.push(`${file.path}: hole ${seg.id} has no reference solution`);
    }
    if (file.action !== "delete" && !segmentsOf(file, "hole").length) warnings.push(`${file.path} has no holes: it will be applied as-is`);
  }
}

const segmentsOf = (file, kind) => file.segments.filter((s) => s.kind === kind);

/** [1,2,3,7,9,10] → "1-3, 7, 9-10" */
function compress(nums) {
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(i === j ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
    i = j;
  }
  return parts.join(", ");
}


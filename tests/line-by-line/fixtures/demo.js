/*
 * A small but realistic session for e2e tests and for trying the game by hand:
 *   node test/fixtures/demo.js type|learn|review   → prints the serve command
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemble, build, buildFocus } from "../../../line-by-line/lib/build.js";
import { dirSource, gitSource } from "../../../line-by-line/lib/sources.js";
import { makeRepo, makeSolution, sh, writeFiles } from "../helpers.js";

export const BEFORE = {
  "package.json": '{\n  "name": "weather-cli",\n  "type": "module"\n}\n',
  "src/config.ts": 'export const config = {\n  baseUrl: "https://api.example.com",\n};\n',
  "src/http/client.ts": [
    'import { config } from "../config.ts";',
    "",
    "export async function getJson(path: string) {",
    "  const res = await fetch(config.baseUrl + path);",
    '  if (!res.ok) throw new Error(`HTTP ${res.status}`);',
    "  return res.json();",
    "}",
    "",
  ].join("\n"),
  "src/legacy.ts": "// Old hand-rolled retry, replaced by src/retry.ts\nexport const RETRIES = 3;\n",
  "tools/main.go": "package main\n\nfunc main() {\n\tprintln(\"hi\")\n}\n",
};

export const AFTER = {
  "src/config.ts": 'export const config = {\n  baseUrl: "https://api.example.com",\n  retries: 3,\n  baseDelayMs: 200,\n};\n',
  "src/retry.ts": [
    'import { config } from "./config.ts";',
    "",
    "const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));",
    "",
    "export async function retry<T>(work: () => Promise<T>, tries = config.retries): Promise<T> {",
    "  for (let attempt = 1; ; attempt++) {",
    "    try {",
    "      return await work();",
    "    } catch (error) {",
    "      if (attempt >= tries) throw error;",
    "      await sleep(config.baseDelayMs * 2 ** (attempt - 1));",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n"),
  "src/http/client.ts": [
    'import { config } from "../config.ts";',
    'import { retry } from "../retry.ts";',
    "",
    "export async function getJson(path: string) {",
    "  return retry(async () => {",
    "    const res = await fetch(config.baseUrl + path);",
    '    if (!res.ok) throw new Error(`HTTP ${res.status}`);',
    "    return res.json();",
    "  });",
    "}",
    "",
  ].join("\n"),
  "src/legacy.ts": null,
  "tools/main.go": "package main\n\nfunc main() {\n\tfor i := 0; i < 2; i++ {\n\t\tprintln(i)\n\t}\n}\n",
};

const NOTES = {
  "src/config.ts": ["How many times to try a request before giving up.", "The first wait between tries. It doubles after every failure."],
  "src/retry.ts": [
    "We read the retry settings from config, so they live in one place.",
    "A promise that resolves after `ms` milliseconds: `await sleep(200)` pauses for 200 ms.",
    "`retry` takes any async `work` and tries it up to `tries` times. `<T>` keeps the result's type.",
    "An endless loop with a counter. We leave it with `return` (success) or `throw` (out of tries).",
    "Run the work. Errors jump to the `catch` below.",
    "Success: return the result straight away.",
    "It failed. Keep the error so we can rethrow it.",
    "Out of tries: give up and let the caller see the real error.",
    "Exponential backoff: 200 ms, then 400 ms, then 800 ms…",
    "Closes the catch block.",
    "Closes the loop.",
    "Closes the function.",
  ],
  "src/http/client.ts": [
    "Bring in the helper from step 1.",
    "Wrap the whole request in `retry`, so a flaky network gets a few more chances.",
    "Same fetch as before, now inside the retried function.",
    "A bad status throws, which makes `retry` try again.",
    "Parse the body as JSON and return it.",
    "Closes the arrow function and the `retry` call.",
  ],
  "tools/main.go": ["A counted loop: `i` goes 0, 1.", "Print the counter (Go uses a tab to indent).", "Closes the loop."],
};

const REMOVED_NOTES = {
  "src/http/client.ts": [
    "The request used to run exactly once. It moves inside `retry` below.",
    "Same status check, now inside the retried function, so a bad status triggers another try.",
    "Same result, now returned from the retried function.",
  ],
  "src/legacy.ts": ["The old hand-rolled retry is gone: `src/retry.ts` replaces it.", "`config.retries` replaces this constant."],
};

const STEPS = [
  {
    id: "01-retry-helper",
    title: "A retry helper",
    tagline: "Try, wait, try again",
    goal: "A small `retry` function that runs any async work again when it fails, waiting longer each time.",
    concepts: ["Exponential backoff", "Generics", "Async loops"],
    setup: ["Open `src/config.ts` and look at what's already configured"],
    tryIt: [{ cmd: "npm test", expect: "The retry tests pass" }],
    reflectionPrompt: "Explain how `retry` decides when to wait, when to try again and when to give up.",
    files: [
      { path: "src/retry.ts", order: 1, role: "Runs async work again with growing waits", intro: "The helper itself." },
      { path: "src/config.ts", order: 2, role: "Retry settings live here", intro: "Two new settings." },
    ],
    diagram: {
      context: [{ path: "src/http/client.ts", note: "Uses retry in step 2" }],
      edges: [
        { from: "src/retry.ts", to: "src/config.ts", label: "reads retries" },
        { from: "src/http/client.ts", to: "src/retry.ts", label: "step 2" },
      ],
    },
  },
  {
    id: "02-use-it",
    title: "Use it everywhere",
    tagline: "Every request gets retries",
    goal: "Wrap the HTTP client in `retry`, and remove the old hand-rolled version.",
    concepts: ["Wrapping a function", "Deleting dead code"],
    setup: [],
    tryIt: [{ cmd: "npm run weather -- Oslo", expect: "Still prints the forecast" }],
    reflectionPrompt: "Why wrap the whole request in `retry` instead of just the `fetch` call?",
    files: [
      { path: "src/http/client.ts", order: 1, role: "Every request now retries", intro: "" },
      { path: "src/legacy.ts", order: 2, role: "The old retry constant, no longer used", intro: "" },
      { path: "tools/main.go", order: 3, role: "A tab-indented Go file", intro: "" },
    ],
    diagram: {
      context: [{ path: "src/retry.ts", note: "From step 1" }],
      edges: [{ from: "src/http/client.ts", to: "src/retry.ts", label: "imports retry()" }],
    },
  },
];

const HOLES = `## src/retry.ts:6-13 retry
Write \`retry\`: call \`work()\`; if it throws, wait \`config.baseDelayMs * 2 ** (attempt - 1)\` ms and try again, up to \`tries\` times. Rethrow the last error.

## src/http/client.ts:5-9 wrap
Wrap the request in \`retry(async () => { ... })\` and return its result.
`;

/** Writes notes for every todo line, using the hand-written NOTES in order and a generic one for the rest. */
function writeNotes(dir) {
  const todo = readFileSync(join(dir, "notes-todo.txt"), "utf8").split("\n");
  const used = {};
  const out = [];
  for (const line of todo) {
    if (!line.includes("\t") || line.startsWith("#")) continue;
    const key = line.split("\t")[0];
    const path = key.slice(0, key.lastIndexOf(":"));
    const removed = key.slice(key.lastIndexOf(":") + 1).startsWith("-");
    used[path] ??= 0;
    used[`-${path}`] ??= 0;
    const note = removed
      ? (REMOVED_NOTES[path]?.[used[`-${path}`]++] ?? "Removed: the old version of this line.")
      : (NOTES[path]?.[used[path]++] ?? `Part of ${path}.`);
    out.push(`${key}\t${note}`);
  }
  writeFileSync(join(dir, "notes.txt"), out.join("\n") + "\n");
}

function writeSteps(dir) {
  const draft = JSON.parse(readFileSync(join(dir, "draft.json"), "utf8"));
  const steps = structuredClone(STEPS);
  if (draft.mode === "review") for (const s of steps) delete s.reflectionPrompt;
  writeFileSync(join(dir, "steps.json"), JSON.stringify({ title: "Retry with backoff", steps }, null, 2));
}

/** A walkthrough of existing code (review mode with --focus): no branch, no diff. */
export function makeWalkthrough() {
  const files = { ...BEFORE, ...Object.fromEntries(Object.entries(AFTER).filter(([, v]) => v !== null)) };
  delete files["src/legacy.ts"];
  const project = makeRepo(files);
  const out = join(project, ".line-by-line", "walkthrough-retry");
  buildFocus({
    project: dirSource(project),
    projectDir: project,
    out,
    task: "how requests are retried",
    focus: [{ path: "src/http/client.ts", ranges: [[4, 10]] }, { path: "src/retry.ts", ranges: [] }],
  });
  writeFileSync(
    join(out, "steps.json"),
    JSON.stringify({
      title: "How requests are retried",
      steps: [
        {
          id: "01-request",
          title: "A request comes in",
          tagline: "getJson wraps fetch",
          goal: "Follow `getJson` from the call to the retry loop.",
          concepts: [],
          files: [
            { path: "src/http/client.ts", order: 1, role: "Fetches JSON from the API", intro: "" },
            { path: "src/retry.ts", order: 2, role: "Runs async work again with growing waits", intro: "" },
          ],
          diagram: { context: [{ path: "src/config.ts", note: "Retry settings" }], edges: [{ from: "src/http/client.ts", to: "src/retry.ts", label: "calls retry()" }] },
        },
      ],
    }),
  );
  writeNotes(out);
  const result = assemble(out);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return { project, sessionDir: out };
}

export function makeDemo(mode = "type") {
  if (mode === "review") {
    const project = makeRepo(BEFORE);
    sh(project, "git", ["checkout", "-qb", "feature/retry"]);
    writeFiles(project, AFTER);
    sh(project, "git", ["add", "-A"]);
    sh(project, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "Add retry"]);
    const base = sh(project, "git", ["merge-base", "main", "HEAD"]).trim();
    const out = join(project, ".line-by-line", "retry-review");
    build({ mode, from: gitSource(project, base), to: gitSource(project, "HEAD"), projectDir: project, out, base, task: "review feature/retry" });
    writeSteps(out);
    writeNotes(out);
    const result = assemble(out);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return { project, sessionDir: out };
  }
  const project = makeRepo(BEFORE);
  const solution = makeSolution(project, AFTER);
  const out = join(project, ".line-by-line", `retry-${mode}`);
  build({ mode, from: dirSource(project), to: dirSource(solution), projectDir: project, out, task: "add retry with exponential backoff to the REST client" });
  writeSteps(out);
  if (mode === "learn") writeFileSync(join(out, "holes.txt"), HOLES);
  else writeNotes(out);
  const result = assemble(out);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return { project, solution, sessionDir: out };
}

if (process.argv[1]?.endsWith("demo.js")) {
  const { project, sessionDir } = makeDemo(process.argv[2] ?? "type");
  console.log(`node ${join(import.meta.dirname, "..", "..", "..", "line-by-line", "cli", "line-by-line")} serve --session ${sessionDir} --project ${project}`);
}

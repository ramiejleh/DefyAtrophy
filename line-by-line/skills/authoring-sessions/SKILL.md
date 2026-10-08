---
name: authoring-sessions
description: How to turn a line-by-line draft into a session. Covers splitting the changes into steps, the suggested file order and roles, the per-step architecture diagram (context files and import arrows), the per-line notes (notes.txt), learn-mode holes and specs (holes.txt), and the private rubric. Use whenever a /line-by-line command has run `line-by-line build` and the session needs authoring, or when `line-by-line assemble` reports errors to fix.
---

# Authoring a line-by-line session

`line-by-line build` has written a draft into the session directory (`$SESSION`). You fill in three
files by hand, run `line-by-line assemble "$SESSION"`, and fix errors until it prints `VALID`:

| File | Modes | What it holds |
|---|---|---|
| `steps.json` | all | steps, file order and roles, diagram |
| `notes.txt` | type, review | one note per line, keyed `path:N` |
| `holes.txt` | learn | which line ranges the user writes, with a spec for each |
| `private/rubric.json` | type, learn | grading notes; the browser never sees it |

Don't edit `draft.json` or `session.json`. They're generated, and `assemble` rewrites `session.json`.

## 1. Steps (`steps.json`)

The template has every changed file in one step. Split it.

- **1–8 steps**, each something a person can hold in their head: one idea, roughly ≤150 typed lines
  (type mode), ≤8 holes (learn mode). A small task can be one step.
- **Dependencies first.** A step only uses what earlier steps built (types and config before logic,
  logic before callers, callers before tests). In review mode, the order *is* the explanation.
- **Each file is in exactly one step.** `assemble` fails if a changed file is missing, so if a big
  file must be split, split the work across steps by file instead.
- `autoApplied` lists untyped changes for that step: lockfiles, binaries, generated files and huge
  files. The draft puts them in the first step. Move them to the step they belong to.

```jsonc
{
  "title": "Retry with backoff",                 // the session title on the map
  "steps": [
    {
      "id": "01-retry-helper",                    // lowercase-dashes, unique
      "title": "A retry helper",
      "tagline": "Try, wait, try again",          // four or five words
      "goal": "A `retry` function that …",        // 1–2 sentences, markdown ok
      "concepts": ["Exponential backoff", "Generics"],
      "setup": [],                                // type/learn: things to do first (env vars, installs)
      "tryIt": [{ "cmd": "npm test", "expect": "The retry tests pass" }],   // type/learn; "(…)" = an instruction, not a command
      "reflectionPrompt": "Explain how …",        // type mode only
      "files": [
        { "path": "src/retry.ts", "order": 1, "role": "Runs async work again with growing waits", "intro": "…" }
      ],
      "autoApplied": ["package-lock.json"],
      "diagram": {
        "context": [{ "path": "src/http/client.ts", "note": "Calls retry in step 2" }],
        "edges": [{ "from": "src/http/client.ts", "to": "src/retry.ts", "label": "imports retry()" }]
      }
    }
  ]
}
```

### File order and roles

- `order` is the **suggested** order: 1, 2, 3… unique within the step. The user may open files in any
  order, so make the suggestion the one that reads best: the file everything else depends on first.
- `role` is the one line on the file's card in the diagram. Say what the file *does*, not what changed:
  "Runs async work again with growing waits", not "Added retry function".
- `intro` (optional) shows in the note panel before the first line.

### The diagram

Each step shows its files inside their real folders, numbered by `order`. You add:

- **context**: 0–4 existing, unchanged files that help place the step's files: the module a new file
  plugs into, a caller, a type it implements. Each has a short `note`. Don't pad this out.
- **edges**: real relationships only (`imports`, `calls`, `implements`, `reads`). Draw them `from` the
  file that depends `to` the file it depends on. Labels are 1–3 words. Every end must be a file in this
  step or one of its context files. Check the actual imports. Never invent an edge.

## 2. Notes (`notes.txt`, type and review)

`notes-todo.txt` lists every line that needs a note:

```
# src/retry.ts (create)
src/retry.ts:5	export async function retry<T>(work: () => Promise<T>, tries = config.retries): Promise<T> {
src/legacy.ts:-1	export const RETRIES = 3;          ← review mode: a removed line (old line number)
```

Write `notes.txt` with the same keys, a **tab**, then the note:

```
src/retry.ts:5	`retry` takes any async `work` and tries it up to `tries` times. `<T>` keeps the result's type.
```

Every listed added line needs a note, or `assemble` fails. In review mode, give each removed block at
least one note (on its first line), saying why it went.

How to write them:

- **What and why, for a beginner.** One or two sentences. Don't read the code back ("declares a
  const"). Say what the line achieves and why it's needed.
- **Introduce a concept the first time it appears** (a generic, `await`, a closure, a regex), then just
  use it later.
- **Closing braces and trivial lines** get a short note ("Closes the retry loop."). They still need one.
- Use markdown backticks for code. `\n` makes a line break. Keep notes about this code, not generic
  tutorials.
- **Review mode** explains the change: what this line does in the new design, and for a modified line,
  what changed. Don't critique, suggest changes, or summarise the PR.

Write notes for a few hundred lines in batches, file by file, appending to `notes.txt`. A short script
that maps keys to notes is fine. The notes themselves must be real, specific and correct.

## 3. Holes (`holes.txt`, learn mode)

`holes-todo.txt` lists each changed region by new-file line range, with its code. Choose what the
user writes:

```
## src/retry.ts:6-13 retry
Write the body of `retry`: call `work()`; if it throws, wait `config.baseDelayMs * 2 ** (attempt - 1)` ms
and try again, up to `tries` times. Rethrow the last error once out of tries.
```

- Header: `## <path>:<start>-<end> <id>`, using **new-file** line numbers (the numbers in
  `holes-todo.txt`). The id is short and unique (`retry`, `parse-args`). The spec follows, in markdown,
  up to the next `##`.
- **Lock the structure, hole the logic.** Imports, types, interfaces, signatures, config and wiring stay
  as given (locked) lines. The bodies that do the work become holes. Lines you don't put in a hole are
  shown as Claude's.
- **3–25 lines per hole.** Smaller is better for beginners. A long function can be several holes if
  there's a natural seam, and a hole may include unchanged lines if rewriting them is part of the task.
- **Specs describe behaviour, not code.** Inputs, outputs, edge cases, and anything the tests check.
  Name what to call, never how to write it. A spec that can only be satisfied by your exact code is a
  bad spec. Several reasonable implementations should all pass.
- A file with no holes is shown read-only and written when the user clicks through. That's right for
  pure wiring.
- **≤40 holes per session.**

## 4. Rubric (`private/rubric.json`, type and learn)

Create `$SESSION/private/` if it doesn't exist. The server never serves anything in it.

```jsonc
{
  "steps": {                                      // type mode: grading reflections
    "01-retry-helper": {
      "keyPoints": ["work is retried only when it throws", "the wait doubles each time", "the last error is rethrown"],
      "misconceptions": ["thinks it retries on success", "confuses tries with waits"]
    }
  },
  "holes": {                                      // learn mode: grading files
    "retry": {
      "mustDo": ["calls work() again after a failure", "waits base * 2^(attempt-1)", "rethrows after the last try"],
      "commonMistakes": ["off-by-one in tries", "swallowing the error", "not awaiting the sleep"],
      "checks": "npx tsx --test test/retry.test.ts"
    }
  }
}
```

## 5. Before assembling

- Every changed file is in exactly one step, and the step order respects dependencies.
- Diagram edges are real and point from dependent to dependency.
- Type/review: every line in `notes-todo.txt` has a note. Learn: every hole has a spec.
- Type/learn: the rubric is written.

Then `line-by-line assemble "$SESSION"`. Errors name the file and line. Fix them and run it again.
`VALID` means every file rebuilds byte for byte into the solution, so what the user produces is exactly
what you verified.

---
description: Practise writing code. Claude designs the architecture (files, signatures, specs) and solves the task in a scratch worktree; the user writes the implementation themselves in the game, file by file, and Claude grades each file by running the project's checks and reviewing it.
argument-hint: <task description>
---

# Line by Line: learn mode

The user wants to practise by building **$ARGUMENTS** themselves. You design it and write a reference
solution, out of sight, in a scratch copy of the project. The game then shows them each file with your
structure in place (imports, types, signatures, unchanged code: locked) and **holes** where the real
work goes. They write those parts freely, submit each file, and you grade it.

Throughout, `lbl` means `"${CLAUDE_PLUGIN_ROOT}/cli/line-by-line"`. Always call it by that full path.

## The rule that matters

**Never write solution code into the user's project, and never show the reference in the chat.**
Work only under `.line-by-line/<slug>/`. A file reaches the project when the user's own version passes
(or they accept a partial). A hook asks the user before any Write/Edit into the project while the game
runs. If you see that prompt, use the worktree path instead.

## 1–3. Scope, scratch copy, solve and verify

Exactly as in type mode (`/line-by-line:type` steps 1–3): restate the task, pick a slug and
`SESSION=.line-by-line/<slug>`, then `git worktree add --detach "$SESSION/worktree" HEAD`. Solve the
task in the worktree and verify it with the project's own checks. The reference must pass them, because
grading compares the user's code against the same checks.

Design for learning: small functions with clear signatures, and names that explain themselves.

## 4. Build the draft

```
lbl build --mode learn --solution "$SESSION/worktree" --task "<the task, in the user's words>" --out "$SESSION"
```

This writes `draft.json`, a `steps.json` template and `holes-todo.txt` (every changed region, by line range).

## 5. Author the session

Load the **`authoring-sessions`** skill and follow its learn-mode section. It covers the steps and
diagram, choosing holes (`holes.txt`) and writing specs, and the private rubric. Then:

```
lbl assemble "$SESSION"
```

Fix every error and assemble again until it prints `VALID`.

## 6. Start the game

Start the server in the background exactly as in type mode:

```
lbl serve --session "$SESSION" > "$SESSION/server.log" 2>&1
```

Give the user the `LBL ready <url>` URL from the log. Explain the game in a few lines:
- the dimmed lines are yours and locked, and the highlighted parts are theirs to write;
- putting the cursor in a part shows its spec;
- Submit sends the file to you for grading;
- "Ask for a hint" nudges them, and after 3 graded attempts they can reveal your version of a part.

## 7. Grade as the user goes

Start a **Monitor** (longest timeout, re-arm on expiry):

```
tail -n 0 -F "$SESSION/server.log" | grep --line-buffered '^LBL '
```

- `LBL submit <stepId> <path> <n>`: load the **`grading`** skill and grade attempt `n` right away. The
  user is watching a spinner.
- `LBL hint <stepId> <path> <holeId>`: write a hint (the `grading` skill says how).
- `LBL file …` / `LBL step-done …` / `LBL skip …`: no action needed.
- `LBL complete`: everything is written, but the last reflection or submission usually arrives
  together with it. Grade whatever `lbl status "$SESSION"` still lists, wait ~10 seconds so the game
  can show the grade, then stop the Monitor and finish.

`lbl status "$SESSION"` lists anything still waiting.

## 8. Finish

As in type mode (step 8, "leave no trace"): run the project's checks in the real project (the
user's code is what's there now), read the grades you need for the summary, then run
`lbl finish "$SESSION"` until it prints `CLEAN`, and confirm `git status` shows only the task's own
changes. Summarise honestly, including how many attempts each file took and anything the user should
revisit.

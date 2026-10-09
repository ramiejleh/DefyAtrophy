---
description: Solve a coding task in a scratch worktree, then have the user type the solution into their project line by line, with a note explaining every line and a graded reflection after each step.
argument-hint: <task description>
---

# Line by Line: type mode

The user wants to build **$ARGUMENTS** themselves. You solve it first, out of sight, in a scratch
copy of the project. They then type your solution into the real project in a browser game, one line
at a time, with your note for every line, and explain each step back to you in a reflection you grade.

Throughout, `lbl` means `"${CLAUDE_PLUGIN_ROOT}/cli/line-by-line"`. Always call it by that full path.

## The rule that matters

**Never write solution code into the user's project.** Every edit goes into the scratch worktree
under `.line-by-line/<slug>/`. Finished files reach the project only when the user types them in the
game. A hook asks the user before any Write/Edit into the project while the game is running. If you
see that prompt, you made a mistake: use the worktree path instead. Don't paste the solution into the
chat either. Typing it is the whole point.

## 1. Scope

- If `$ARGUMENTS` is empty or ambiguous, ask what to build. Restate the task in one sentence.
- Pick a short kebab-case slug (e.g. `retry-backoff`). `SESSION=.line-by-line/<slug>` from the project root.
- Run `git status --porcelain`. If files the task will probably touch have uncommitted changes, say so
  and ask whether to include them in the scratch copy.

## 2. Scratch copy

- Git: `git worktree add --detach "$SESSION/worktree" HEAD`. If the user wants their uncommitted changes
  included: `git diff HEAD | git -C "$SESSION/worktree" apply`, and copy untracked files the task needs.
- Not git: copy the project into `$SESSION/worktree`, skipping `.line-by-line` and dependency folders.
- Dependencies: link rather than reinstall where you can (e.g. `ln -s "$PWD/node_modules" "$SESSION/worktree/node_modules"`).

## 3. Solve and verify, in the worktree

Solve the task normally, but only ever edit files under `$SESSION/worktree/`. Keep the solution
focused. Every changed line becomes a line the user types, so don't reformat untouched code.
Then verify it there with the project's own checks (tests, type-check, lint, build). Don't continue
until they pass. If the project has no way to verify, say plainly that the solution is unverified.

Size: aim for under ~600 typed lines. If it's bigger, suggest splitting the task into sessions.

## 4. Build the draft

```
lbl build --mode type --solution "$SESSION/worktree" --task "<the task, in the user's words>" --out "$SESSION"
```

This writes `draft.json`, a `steps.json` template and `notes-todo.txt` (every line to type).

## 5. Author the session

Load the **`authoring-sessions`** skill and follow it. It covers splitting into steps, the
suggested file order, the architecture diagram, the per-line notes and the private rubric. Then run:

```
lbl assemble "$SESSION"
```

Fix every error it reports and assemble again until it prints `VALID`.

## 6. Start the game

Start the server **in the background** (Bash `run_in_background`):

```
lbl serve --session "$SESSION" > "$SESSION/server.log" 2>&1
```

It opens the browser itself. Read the `LBL ready <url>` line from `$SESSION/server.log` and give the
user that exact URL (it carries the session token). Then explain the game in three or four lines:
steps unlock in order, each step shows where its files live with a suggested order, the user types
the ghost line exactly (Tab autocompletes for 0 XP, Shift+Tab hides the ghost text), and finished
files are written into their project.

## 7. Grade as the user goes

Start a **Monitor** on the events, with the longest timeout available, and re-arm it if it expires:

```
tail -n 0 -F "$SESSION/server.log" | grep --line-buffered '^LBL '
```

- `LBL reflection <stepId>`: load the **`grading`** skill and grade the reflection right away.
- `LBL file <path>` / `LBL step-done <stepId>` / `LBL skip <path>`: no action needed. A `skip` means
  the user kept their own version of a file that had changed on disk. Mention it in the final summary.
- `LBL complete`: everything is written, but the last reflection or submission usually arrives
  together with it. Grade whatever `lbl status "$SESSION"` still lists, wait ~10 seconds so the game
  can show the grade, then stop the Monitor and finish.

If anything is pending when you start (for example after a restart), `lbl status "$SESSION"` lists it.

## 8. Finish: leave no trace

When it's over, the project must look exactly as if you had implemented the task directly: the
feature's files and nothing else. No session data, no worktree, no git exclude entry.

1. Run the project's checks in the **real** project and note the results.
2. Read the grades and reflections you'll want for the summary. They're about to be deleted.
3. Run `lbl finish "$SESSION"`. It stops the game server, removes the scratch worktree, deletes the
   session data, and once no other sessions are left, deletes `.line-by-line/` and the
   `.git/info/exclude` entry it added. It prints `CLEAN` when nothing is left. If it lists leftovers,
   fix them.
4. Check `git status --porcelain` and `git worktree list`: only the task's own changes should show,
   and no extra worktree.
5. Summarise what changed in a few lines, plus the check results and how the reflections went.

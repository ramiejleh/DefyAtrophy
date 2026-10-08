---
description: Step through code line by line, with a note on every line, by tabbing (no typing, nothing written). Either your current branch's changes in a logical order, or a walkthrough of existing code — e.g. "/line-by-line:review the auth implementation".
argument-hint: "[base ref | what to walk through, e.g. \"the auth implementation\"]"
allowed-tools: Bash, Read, Write, Glob, Grep, Skill, Monitor
---

# Line by Line: review mode

The user wants to read code carefully, one line at a time, in an order that makes sense. You choose
the order and write a note for every line. The game lets them step through with Tab or the arrow
keys. It never writes to the project, and nothing goes anywhere else.

Throughout, `lbl` means `"${CLAUDE_PLUGIN_ROOT}/bin/line-by-line"`. Always call it by that full path.

## 0. Which kind of review

`$ARGUMENTS` decides it:

- **Empty, or a git ref** (`git rev-parse --verify --quiet "$ARGUMENTS^{commit}"` succeeds): a
  **branch review**. Step through the current branch's commits since the merge-base with that ref
  (default: the repo's default branch). Follow section A.
- **Anything else** ("the auth implementation", "how uploads get processed"): a **walkthrough** of
  existing code, whether or not it was ever a PR. Follow section B.

In both kinds, the notes explain what each line does and why it's there. Don't write an overview, a
verdict, a critique or suggested changes.

## A. Branch review

1. If `git status --porcelain` shows uncommitted changes, say that they aren't included. Slug:
   `review-<branch>` in kebab-case. `SESSION=.line-by-line/<slug>`.
2. `lbl build --mode review --base "<ref>" --task "review <branch>" --out "$SESSION"` (leave out
   `--base` for the default branch). `notes-todo.txt` lists every added line (`path:N`) and removed
   line (`path:-N`).
3. Read the changed files properly, then load the **`authoring-sessions`** skill and follow its
   review-mode section. Order the steps so a reader can follow them: types and data first, then the
   core logic, then the callers, then tests and config. Not alphabetical file order.

## B. Walkthrough of existing code

1. **Find it.** Glob and Grep for the entry points and the files involved, cheap and broad first.
   Then **trace the flow** from where it starts (a route, a CLI command, a handler) to where the work
   finishes.
2. **Pick the lines.** Choose the files, and within large files the line ranges, that carry the flow.
   Leave out boilerplate and unrelated parts of a file. They stay visible as dimmed context. Aim for
   under ~600 lines in total. If it's more, say so and suggest splitting the topic.
3. If the topic is ambiguous ("auth" could mean login, sessions or permissions), propose the outline
   (step titles only) and let the user correct it before writing notes.
4. Slug: `walkthrough-<topic>` in kebab-case, `SESSION=.line-by-line/<slug>`. Build with one `--focus`
   per file, in the order the code runs. Ranges are optional:
   ```
   lbl build --mode review --task "<what the user asked for>" --out "$SESSION" \
     --focus src/routes/login.ts --focus src/auth/session.ts:12-80,95-120 --focus src/auth/token.ts
   ```
5. Load the **`authoring-sessions`** skill and follow its review-mode section. The steps follow
   **execution order** (request in → validation → the core → storage → response), and each step's
   diagram shows where its files sit, with real call/import edges.

## Then, for both kinds

1. `lbl assemble "$SESSION"`. Fix every error until it prints `VALID`.
2. Start the server **in the background**:
   ```
   lbl serve --session "$SESSION" > "$SESSION/server.log" 2>&1
   ```
   Give the user the `LBL ready <url>` URL from the log and tell them in two lines:
   - each step shows where its files live, with a suggested order;
   - in a file, Tab, Enter or ↓ moves to the next line, and Shift+Tab or ↑ goes back.
3. Start a **Monitor** (`tail -n 0 -F "$SESSION/server.log" | grep --line-buffered '^LBL '`, longest
   timeout, re-arm on expiry). On `LBL complete` (every file stepped through), or when the user says
   they're done, or on `/line-by-line:cleanup`: wait ~10 seconds so the final screen shows, then run
   `lbl finish "$SESSION"`. It stops the server and removes every trace of the session. Nothing is left
   in the project.

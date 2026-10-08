---
description: Step through the current local branch's changes line by line in a logical order (not file order), with a note on every changed line. No typing, nothing written. Just a careful read of the branch.
argument-hint: "[base branch or ref, default: the repo's default branch]"
allowed-tools: Bash, Read, Write, Glob, Grep, Skill
---

# Line by Line: review mode

The user wants to read the changes on their **current local branch** carefully, line by line, in an
order that makes sense. You order the changes and write a note for each changed line. The game lets
them step through with Tab or the arrow keys. It never writes anything, and nothing goes to GitHub.

This is not a PR review. Don't write an overview, a summary, a verdict or suggested changes. The
notes explain what each line does and why it's there, nothing more.

Throughout, `lbl` means `"${CLAUDE_PLUGIN_ROOT}/bin/line-by-line"`. Always call it by that full path.

## 1. What to review

- Base: `$ARGUMENTS` if given, otherwise the repo's default branch (the CLI works it out). The diff is
  `merge-base(base, HEAD)` → `HEAD`, which is exactly the branch's own commits.
- If `git status --porcelain` shows uncommitted changes, say that they aren't included (only commits are).
- Slug: `review-<branch-name>` in kebab-case, and `SESSION=.line-by-line/<slug>`.

## 2. Build the draft

```
lbl build --mode review --base "<base>" --task "review <branch>" --out "$SESSION"
```

(Leave out `--base` to use the default branch.) It writes `draft.json`, a `steps.json` template, and
`notes-todo.txt`, which lists every added line (`path:N`) and removed line (`path:-N`).

## 3. Author the session

Read the changed files properly first. Then load the **`authoring-sessions`** skill and follow its
review-mode section. The order is the point: group the changes into steps a reader can follow (types
and data first, then the core logic, then the callers, then tests and config), not alphabetical file
order. Then:

```
lbl assemble "$SESSION"
```

Fix every error until it prints `VALID`.

## 4. Open it

```
lbl serve --session "$SESSION" > "$SESSION/server.log" 2>&1
```

Run that in the background, give the user the `LBL ready <url>` URL, and tell them in two lines:
- each step shows where its files sit in the project, with a suggested order;
- in a file, Tab, Enter or ↓ moves to the next changed line, and Shift+Tab or ↑ goes back.

There's no grading and no Monitor. You're done once the URL is printed. Stop the server when the user
says they've finished, or on `/line-by-line:cleanup`.

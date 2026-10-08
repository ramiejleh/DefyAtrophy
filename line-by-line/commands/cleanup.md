---
description: Remove line-by-line sessions — stops the game server, removes the scratch worktree, and deletes the session data. Lists and confirms before deleting anything.
argument-hint: "[session slug, default: all sessions]"
allowed-tools: Bash
---

# Clean up line-by-line sessions

`lbl` means `"${CLAUDE_PLUGIN_ROOT}/bin/line-by-line"`.

1. Run `lbl list`. Take the session named in `$ARGUMENTS`, or all of them.
2. Show what will go: each session's directory (`.line-by-line/<slug>/`) and whether it has a running
   server or a worktree. Say that its progress, reflections and grades go with it. Files already written
   into the project stay. **Ask for confirmation** before deleting anything.
3. For each confirmed session:
   - stop its server if it's running: the pid is in `.line-by-line/<slug>/ACTIVE`, or stop the
     background task you started;
   - `git worktree remove --force .line-by-line/<slug>/worktree` if a worktree exists (then
     `git worktree prune`);
   - `rm -rf .line-by-line/<slug>`.
4. If `.line-by-line/` is now empty, remove it too. Report what was removed.

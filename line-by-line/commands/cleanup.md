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
3. For each confirmed session, run `lbl finish .line-by-line/<slug>`. It stops the server, removes
   the worktree, deletes the session data, and once no sessions are left, removes `.line-by-line/` and
   the `.git/info/exclude` entry it added.
4. Report what was removed, and anything `finish` says is left over.

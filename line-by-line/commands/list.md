---
description: List the line-by-line sessions in this project, with their mode, progress, whether the game is running, and anything waiting for Claude.
---

Run `"${CLAUDE_PLUGIN_ROOT}/cli/line-by-line" list` from the project root and show the output as a
short table: slug, mode, title, progress, and flags (server running, worktree present, items waiting
for Claude). If something is waiting for Claude, suggest `/line-by-line:resume <slug>`.

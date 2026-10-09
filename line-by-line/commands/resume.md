---
description: Reopen a line-by-line session after a break or a new Claude session. Restarts the game server and the grading loop, and grades anything submitted while nobody was watching.
argument-hint: "[session slug]"
---

# Resume a line-by-line session

`lbl` means `"${CLAUDE_PLUGIN_ROOT}/cli/line-by-line"`.

1. Run `lbl list` from the project root. Pick the session named in `$ARGUMENTS`, or the only/most
   recent one that isn't complete. If it's ambiguous, ask. `SESSION=.line-by-line/<slug>`.
2. Run `lbl status "$SESSION"` to see the mode, the progress, and anything **waiting for Claude**.
3. If `list` doesn't show `[server running]`, start the server in the background as the original
   command did (`lbl serve --session "$SESSION" > "$SESSION/server.log" 2>&1`), and give the user the
   new `LBL ready <url>`. The old URL's token no longer works.
4. Type and learn mode: start the Monitor again
   (`tail -n 0 -F "$SESSION/server.log" | grep --line-buffered '^LBL '`), then load the **`grading`**
   skill and clear everything `status` listed as waiting: ungraded reflections, ungraded submissions
   (latest attempt first) and unanswered hints.
5. Carry on with the original command's last steps (`/line-by-line:type`, `/line-by-line:learn`,
   `/line-by-line:review`), including finishing with `lbl finish "$SESSION"` so nothing is left behind.

The rule from the original command still holds: no solution code goes into the project except
through the game.

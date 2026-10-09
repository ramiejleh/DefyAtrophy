# line-by-line

**Write the code yourself, line by line.** Claude does the thinking out of sight: it solves the task in
a scratch git worktree and checks it with your project's own tests. You then build it into your real
project yourself, in a small browser game. It has three modes:

| Command | You… | Claude… |
|---|---|---|
| `/line-by-line:type <task>` | type the solution, one line at a time, with a note explaining every line | solves and verifies it, writes the notes, grades a short reflection after each step |
| `/line-by-line:learn <task>` | write the real logic yourself, inside Claude's architecture (files, types, signatures) | designs it, writes a reference, runs your project's checks against **your** code and grades each file |
| `/line-by-line:review [base]` | step through your current branch's changes, line by line, in a logical order | orders the changes and explains every changed line. No typing, nothing written, nothing sent anywhere |
| `/line-by-line:review <topic>` | walk through existing code, e.g. `the auth implementation`, line by line | traces the flow, picks the files and line ranges in execution order, explains every line |

Files reach your project only through the game. In type and learn mode, a hook asks you before Claude
writes into the project while a session is running. When a session ends, Claude removes every trace of
it: the scratch worktree, the session data and the git exclude entry. Your project is left exactly as if
the code had been written directly.

https://github.com/user-attachments/assets/f480ded5-1e19-4099-b590-e13b4be3e60d

<details>
<summary>Can't play the video here? An animated preview</summary>

![line-by-line in action: typing a file with a note on every line, a graded learn-mode attempt, and review mode stepping through changes](docs/demo.gif)

</details>

![A step: its files in their real folders, numbered in a suggested order, with import arrows](docs/step-diagram.jpg)

## How it plays

1. **Steps.** The task is split into a few steps that build on each other, drawn as spools on a thread.
   In type and learn mode, each step unlocks when the previous one is done.
2. **Where the files live.** Opening a step shows its files inside their real folders, numbered in a
   suggested order, with arrows for who imports whom and a few existing files for context. Open any
   file in any order. Finished files reopen read-only.
3. **The file.**
   - **Type mode** shows the whole file. Existing lines are dimmed, removed lines are struck through,
     and the lines you type are marked. Scroll anywhere for context: keystrokes only ever go into the
     next line you type, and a pill takes you back to it. A typo turns red and blocks the line until you
     fix it. Tab autocompletes (for 0 XP), Shift+Tab hides the ghost text, and pasting is blocked. Every
     line comes with Claude's note, and every finished line weaves a row on your loom.
   - **Learn mode** gives you a real editor. Claude's lines are locked, and the highlighted parts are
     yours to write. Put the cursor in one to see its spec. Submit the file, and Claude runs your
     project's checks against your code and reviews it, with inline comments. You can ask for a hint;
     after three graded attempts you can reveal Claude's version of a part.
   - **Review mode** steps through every added and removed line with Tab, Enter or the arrow keys.
4. **After each step** (type mode), you explain what you built in your own words, and Claude grades it
   within seconds.

| Type | Learn | Review |
|---|---|---|
| ![Type mode](docs/type-mode.jpg) | ![Learn mode](docs/learn-mode.jpg) | ![Review mode](docs/review-mode.jpg) |

## Install

```
/plugin marketplace add ramiejleh/DefyAtrophy
/plugin install line-by-line@DefyAtrophy
/reload-plugins
```

You need **Node.js 20+** and a browser. Type and learn mode need a git repository (for the scratch
worktree), or Claude copies the project instead. Review mode needs git.

## Commands

| Command | What it does |
|---|---|
| `/line-by-line:type <task>` | Solve in a worktree, then type it in the game |
| `/line-by-line:learn <task>` | Solve and design in a worktree, then write it yourself, graded per file |
| `/line-by-line:review [base]` | Step through the branch's commits since `base` (default: the default branch) |
| `/line-by-line:review <topic>` | Walk through existing code on a topic, in the order it runs |
| `/line-by-line:resume [slug]` | Restart the game and grading after a break or a new Claude session |
| `/line-by-line:list` | Sessions in this project, with progress and anything waiting for grading |
| `/line-by-line:cleanup [slug]` | Stop the server and remove a session that never finished (asks first) |

## What lives where

While a session runs, its data lives in your project under `.line-by-line/<slug>/`. It's added to
`.git/info/exclude`, so it never shows up in `git status` and your `.gitignore` isn't touched. When the
session finishes, `line-by-line finish` deletes all of it, including the exclude entry it added and the
folder itself once no other sessions are left.

```
.line-by-line/<slug>/
  session.json            steps, files and lines (what the game shows)
  private/                rubric and learn-mode reference (never served to the browser)
  progress.json           your progress, XP and drafts
  reflections/ grades/    your reflections, Claude's grades
  submissions/ hints/     learn mode
  worktree/               Claude's scratch solution
  server.log              game events Claude listens to
```

The game server only listens on `127.0.0.1`, needs the per-launch token in the URL Claude gives you,
refuses requests from other sites, and only writes files that belong to the session, inside the
project.

## Under the hood

`cli/line-by-line` is a small CLI with no dependencies that Claude drives:

```
line-by-line build     --mode type|learn|review …   diff the solution (or the branch) into a draft
                       --mode review --focus a.ts:10-40 …   or walk through existing code
line-by-line assemble  <session>                    merge steps.json + notes.txt / holes.txt, validate
line-by-line validate  <session>                    every file rebuilds byte for byte (tabs, CRLF, final newline)
line-by-line serve     --session <dir>              start the game, print "LBL ready <url>"
line-by-line check     <session> <path>             learn mode: put the latest submission in check/ for testing
line-by-line status    <session>                    progress and anything waiting for Claude
line-by-line list
line-by-line finish    <session>                    stop the server, remove the worktree and every trace of the session
```

Highlighting and the learn-mode editor use a vendored [CodeMirror 5](https://codemirror.net/5/) (MIT),
so the game works offline.

## Development

```
npm test                                             # unit, API, CLI and hook tests (node:test)
node test/fixtures/demo.js type|learn|review          # build a demo session, print the serve command
PUPPETEER=<dir>/node_modules/puppeteer-core CHROME=<chrome binary> node test/e2e.mjs   # browser e2e
claude --plugin-dir ./line-by-line                    # try the plugin locally
```

`puppeteer-core` isn't a dependency: install it in a scratch directory for the e2e run.

## License

MIT © Rami Ejleh. CodeMirror is MIT © Marijn Haverbeke and others (`game/public/vendor/codemirror/LICENSE`).

# DefyAtrophy

A [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin marketplace by
[Rami Ejleh](https://github.com/ramiejleh). Add it once, then install any plugin listed
below from inside Claude Code.

## Plugins

| Plugin | Description |
| --- | --- |
| [**interactive-pr-review**](./interactive-pr-review) | Interactively review GitHub PRs (comments only) — Claude fetches the PR, writes a holistic overview, groups the diff into logical chunks with neutral descriptions and inline insight bubbles, presents them in an IDE-highlighted review UI, and posts your line- and file-level comments back to GitHub in one click. |
| [**line-by-line**](./line-by-line) | Write the code yourself, line by line. Claude solves a task in a scratch git worktree and verifies it, then you build it into your project in a small browser game: **type** it with a note on every line, **learn** by writing the logic yourself inside Claude's architecture with each file graded against your project's checks, or **review** by tabbing through your branch's changes, or any existing code ("the auth implementation"), in a logical order. Each step opens on a diagram of where its files live. When it's done, nothing is left behind but the code. |
| [**walkthrough**](./walkthrough) | Turns a feature into a paginated HTML walkthrough you read like a book — real code excerpts in execution order, one step per page, with the explanation for each hidden behind a click so you read the code and form your own understanding first. Works on any existing code, not just what Claude wrote. |

## line-by-line at a glance

```
/plugin marketplace add ramiejleh/DefyAtrophy
/plugin install line-by-line@DefyAtrophy
/reload-plugins
```

| Command | What happens |
| --- | --- |
| `/line-by-line:type <task>` | Claude solves the task in a scratch worktree and checks it with your tests. You type the solution into your project one line at a time, with a note explaining every line, and write a short reflection after each step that Claude grades. |
| `/line-by-line:learn <task>` | Claude designs the files and signatures. You write the actual logic in an in-browser editor, and Claude runs your project's checks against **your** code and grades each file, with hints and inline comments. |
| `/line-by-line:review [base]` | Tab through your current branch's changes line by line, in a logical order, with a note on each line. Nothing is written. |
| `/line-by-line:review <topic>` | The same, for existing code: e.g. `/line-by-line:review the auth implementation` traces the flow and walks you through it in the order it runs. |
| `/line-by-line:resume`, `:list`, `:cleanup` | Pick a session back up, list sessions, or remove one that never finished. |

Every session starts on a map of steps; each step shows its files inside their real folders with a
suggested order (open them in any order), and edits to existing files show the whole file with only
your lines typeable. Needs Node.js 20+ and a browser. Full details:
[line-by-line/README.md](./line-by-line/README.md).

## Add the marketplace

```
/plugin marketplace add ramiejleh/DefyAtrophy
```

## Install a plugin

```
/plugin install interactive-pr-review@DefyAtrophy
/plugin install line-by-line@DefyAtrophy
/plugin install walkthrough@DefyAtrophy
/reload-plugins
```

> You **add** the marketplace by `owner/repo` and **install** from its registered
> *name* — the `name` field in `marketplace.json`. Here both are `DefyAtrophy`, so
> the two commands read the same either way.

## Update

To pick up a newer version after one is published:

```
/plugin marketplace update DefyAtrophy       # refresh the listing
/plugin install interactive-pr-review@DefyAtrophy
```

## Repository structure

```
.
├── .claude-plugin/marketplace.json   # marketplace listing
├── .github/CODEOWNERS                # review owners
├── README.md                         # this file
├── interactive-pr-review/            # a plugin (see its own README)
├── line-by-line/                     # a plugin (see its own README)
└── walkthrough/                      # a plugin (see its own README)
```

## License

MIT © Rami Ejleh

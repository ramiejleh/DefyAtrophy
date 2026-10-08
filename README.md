# DefyAtrophy

A [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin marketplace by
[Rami Ejleh](https://github.com/ramiejleh). Add it once, then install any plugin listed
below from inside Claude Code.

## Plugins

| Plugin | Description |
| --- | --- |
| [**interactive-pr-review**](./interactive-pr-review) | Interactively review GitHub PRs (comments only) — Claude fetches the PR, writes a holistic overview, groups the diff into logical chunks with neutral descriptions and inline insight bubbles, presents them in an IDE-highlighted review UI, and posts your line- and file-level comments back to GitHub in one click. |
| [**line-by-line**](./line-by-line) | Write the code yourself, line by line. Claude solves a task in a scratch worktree, then you type it into your project with a note on every line, write it yourself inside Claude's architecture with each file graded, or step through your branch's changes in a logical order. Each step opens on a diagram of where its files live. |
| [**walkthrough**](./walkthrough) | Turns a feature into a paginated HTML walkthrough you read like a book — real code excerpts in execution order, one step per page, with the explanation for each hidden behind a click so you read the code and form your own understanding first. Works on any existing code, not just what Claude wrote. |

## Add the marketplace

```
/plugin marketplace add ramiejleh/DefyAtrophy
```

## Install a plugin

```
/plugin install interactive-pr-review@DefyAtrophy
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

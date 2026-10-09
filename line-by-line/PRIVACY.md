# line-by-line privacy policy

_Last updated: 9 October 2026_

line-by-line is a free, open-source plugin for Claude Code, maintained by Rami Ejleh. This policy covers the
plugin itself: the commands, skills, hook, command-line tool and browser game in this folder.

## The short version

line-by-line doesn't collect, sell or share any data. It has no accounts, analytics, telemetry or tracking, and the
plugin itself sends nothing over the internet. Everything it stores stays in your project folder on your computer,
and it's deleted when a session ends.

## What the plugin stores, and where

While a session is running, the plugin keeps its working files in your project, under `.line-by-line/<session>/`:

- the session itself: the steps, files and lines Claude prepared, including its notes for each line;
- a scratch copy of your project (a git worktree) where Claude writes and checks its solution, in type and learn
  mode, and in learn mode a second copy where your submissions are tested;
- your progress in the game: which lines you've typed, your stats, and any code you've drafted in learn mode;
- what you submit: your reflections (type mode) and your versions of each file (learn mode);
- Claude's grades, hints and comments on those submissions;
- a log of game events (for example "a reflection was submitted"), which Claude reads to know when to grade.

The plugin also adds one line, `.line-by-line/`, to your repository's `.git/info/exclude` file, so these files never
show up in `git status`. Files you finish in the game are written into your project, which is the point of the
plugin.

When a session ends, `line-by-line finish` deletes the session folder, the scratch copy and the exclude line. You
can also remove a session at any time with `/line-by-line:cleanup`.

## What leaves your computer

**From the plugin: nothing.** The browser game is served by a small server that listens only on `127.0.0.1`, your
own computer. Its data requests (reading the session and saving your progress and files) need a random token
created when it starts, and it refuses requests from other websites. The game page loads no fonts, scripts or
images from the internet; everything it uses is bundled with the plugin.

**Through Claude Code: what you'd expect from using Claude.** The plugin asks Claude to read your code, write a
solution, explain it, and grade your reflections and submissions. Like anything you do in Claude Code, that content
is sent to Anthropic so Claude can respond. The plugin doesn't add any other destination. How Anthropic handles that
data is covered by [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

## What the plugin runs on your computer

- `git`, to create and remove the scratch copy, and to read changes in review mode;
- Node.js, for the plugin's command-line tool and the local game server;
- your browser, which the plugin opens on the game's local address;
- your project's own checks, such as its tests, which Claude runs in type and learn mode;
- a hook that, while a game is running, asks you before Claude edits your project. It reads only the request Claude
  Code passes to it and the session's marker files.

## Children

line-by-line is a developer tool and isn't directed at children under 18.

## Changes to this policy

If the plugin starts handling data differently, this file will be updated in the same release, and the change will
show in the repository's history.

## Contact

Questions about privacy or this policy: open an issue at
[github.com/ramiejleh/DefyAtrophy/issues](https://github.com/ramiejleh/DefyAtrophy/issues).

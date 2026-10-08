---
name: grading
description: How to grade line-by-line work while the user plays. Covers reflections after each type-mode step, learn-mode file submissions (run the project's checks against the user's code, then review it), and learn-mode hint requests. Use on `LBL reflection`, `LBL submit` or `LBL hint` events from a running session, or for anything `line-by-line status` lists as waiting for Claude.
---

# Grading line-by-line work

The user is watching the game for your answer, so grade promptly. Everything you write lands in
`$SESSION` (the session directory) as JSON, and the game picks it up within a few seconds. Keep it to
that file. You don't need to say anything in the chat beyond a one-line note.

Your feedback should leave the user understanding more than before. Be honest, be specific, quote
their own words or code, and **never hand over the answer**. Point at the gap and ask the question
that leads to it.

## Reflections (type mode): `LBL reflection <stepId>`

1. Read `$SESSION/reflections/<stepId>.md`, the step in `$SESSION/session.json` (its goal, concepts,
   files and reflection prompt), and `$SESSION/private/rubric.json` → `steps.<stepId>`.
2. Decide:
   - **pass**: covers the key points in their own words, with no real misconception.
   - **partial**: mostly right, but misses a key point or is vague where it matters.
   - **retry**: a misconception, or mostly restating the prompt or the code.

   Judge understanding, not prose. Short and right beats long and vague.
3. Write `$SESSION/grades/steps/<stepId>.json` (create the folders):

```json
{ "verdict": "pass", "score": 88, "feedback": "You nailed **why** the token is cached …\n\n- One thing to check: …" }
```

Feedback is 2–5 sentences of markdown. Start with what they got right, specifically. Then the gap, as
a question or a pointer to the line that shows it ("Look at line 12 of `retry.ts`: what happens on the
last attempt?"). If they rewrite a reflection, a new `LBL reflection` arrives. Grade it fresh.

## File submissions (learn mode): `LBL submit <stepId> <path> <n>`

1. Run `"${CLAUDE_PLUGIN_ROOT}/bin/line-by-line" check "$SESSION" "<path>"`. It rebuilds attempt `n`
   into `$SESSION/check/` (a copy of the reference solution) and prints the file's location and the
   grade file to write.
2. **Run the project's checks from `$SESSION/check/`**: the relevant tests, the type-check, the lint
   (`rubric.holes.<id>.checks` if you wrote one). Later files may not exist yet in the user's version,
   so focus on checks that cover this file.
3. Read their code (the file in `check/`) against each hole's spec and the rubric's `mustDo` and
   `commonMistakes`. Different-but-correct is correct, so don't grade against your reference's style.
4. Decide:
   - **pass**: meets every spec, and the checks pass.
   - **partial**: works for the main path, but misses an edge case, has a small bug or a real smell.
     The user may accept it and move on.
   - **retry**: doesn't work, doesn't meet the spec, or fails the checks.
5. **Add** an entry to the JSON array in `$SESSION/grades/files/<encoded path>.json` (`check` prints the
   exact name; create the file as `[]` first if needed). Never rewrite earlier attempts:

```json
[
  { "attempt": 1, "verdict": "retry", "score": 35, "feedback": "The loop runs, but …", "comments": [{ "line": 9, "text": "What happens when `attempt` equals `tries`?" }] }
]
```

`line` numbers refer to the file in `check/` (the same numbering the editor shows). Use 1–4 comments
on the lines that matter. If a check fails, quote the failing test's name and the relevant line of
output in the feedback, without the fix. On a pass, the game writes the file into the project itself.

## Hints (learn mode): `LBL hint <stepId> <path> <holeId>`

Read the hole's spec, the user's current draft (`$SESSION/progress.json` → `files.<path>.draft.<holeId>`,
or their latest submission), and the reference. Add an entry to `$SESSION/hints/<encoded path>.json`
(an array; the encoding is the same as for grades, e.g. `src%2Fretry.ts.json`):

```json
[{ "holeId": "retry", "text": "Think about the loop's exit conditions: there are two, one for success and one for running out of tries.", "at": "<current ISO time>" }]
```

A hint is a nudge toward the next step from where *they* are. Give a concept, a question or the name
of something to look up. Never give code that solves the hole. Each new hint for the same hole can be
a little more concrete than the last.

## When something's off

- The user's code is fine but your check is wrong (flaky or too strict): grade the code, and say so.
- A reflection or submission is empty or obviously a placeholder: `retry`, with kind, short feedback.
- You can't run the checks at all: grade by review, and say in the feedback that the checks didn't run.

# trust-prompt-visible-1629: a Claude Code trust dialog reads as needs_you, with the question as evidence

Card: kosmos#1629, point 3 ("surface it"). Points 1 and 2 shipped in #1640 and #1660 and
are served in 0.6.20. This branch is the remaining half: an agent stopped on the workspace
trust dialog must be visible in Kosmos as blocked-and-why, not silently unknown.

## What was measured before writing anything

- The live dialog was OBSERVED on this machine 2026-09-01 by starting `claude` in a fresh
  folder in a throwaway tmux session (captured, then Escape, session killed). Its question
  row runs past the `?` into a parenthetical, so `asksSomething`'s "marker opens the line
  and the line ends at `?`" rule cannot see it.
- Planted through the shipped `classify()` on main: the live capture and the card's own
  2026-08-30 capture BOTH read `unknown`. Controls: a quoted mention reads `unknown` (correct),
  `Do you want to proceed?` reads `needs_you` (the instrument works).
- `optionsIn` needs numbered options; this dialog has none, so it yields no buttons today
  and still will not after this change (deliberate, see below).

## The change

- `engine/status.js`: `trustPrompt(tail)`, a structural detector: the question row opens a
  row AND one of the two option labels sits on its own row within 12 rows beneath it.
  Checked in `classify()` after `auth_failed` and before `asksSomething`, returning
  `needs_you` (scraped) with a reason that names WHICH question and the question row as
  `evidence`, the way `auth_failed` carries its line. `TRUST_PROMPT_MARKER` joins
  `ALL_NEEDS_YOU_MARKERS` so `chat.questionIn` anchors on it and the board shows the
  question, options and highlighted answer, in the agent's chat view.
- `engine/status.test.js`: six arms. Both observed shapes read needs_you with evidence;
  the flipped highlight still reads needs_you; five prose/mention shapes do NOT; the
  evidence is one capped row; reconcile rule 3 keeps it over a fresh `working` report with
  the conflict surfaced (fixture built with the suite's own `rep()`, and a control arm in
  which the same report DOES win over a scraped idle).
- `engine/chat.test.js`: `questionIn` finds the dialog with both options and the folder
  run-up; `optionsIn` returns null.

## Decided, and why

- NOT a new state. It is a question only the person can answer; `needs_you` already
  renders as attention and rule 3 already protects it from a stale self-report.
- NO buttons. A button types a digit into the pane and nobody has measured what this
  dialog does with a digit. Wrong guess, and the pre-selected answer is "No, exit".
  Follow-up once measured: Down+Enter as an explicit "Yes, I trust this folder" action.
- NO web change. The state and the question text already reach the agent page through
  the existing `asking` -> `questionIn` path; the board is not browser-tested on this
  branch because the browser gate was held by another agent during the build.

## Negative arm

The same fixtures classify `unknown` on main (measured before the change) and `needs_you`
on this branch; the suite's new arms are red on main by construction.

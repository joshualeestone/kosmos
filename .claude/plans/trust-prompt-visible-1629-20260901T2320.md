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

## Challenge-loop iteration 1 changed three things and recorded one follow-up

- **A verbatim paste of the dialog is not the dialog.** The first detector matched a dialog
  quoted inside a tool result (the card itself quotes it), and rule 3 would have stood that
  false red over the agent's fresh working report. Fix: a third structural row. A real dialog
  replaces the composer and is the bottom of the screen (observed in the probe: the confirm
  row is the last non-blank row); a paste always has a footer, a working line or prose beneath
  it. The detector now requires the tail's last non-blank row to be a dialog row. Cost: a
  capture whose dialog is not at the bottom reads unknown, the honest default.
- **"Default answer exits", not "highlighted".** The detector strips the selector glyph and
  does not know where the caret is. The default is a fact about the dialog.
- **The marker questionIn uses now carries the detector's strip class**, so a box-framed row
  reads the same on the card and on the page. And a reported needs_you now carries the
  screen's question row as evidence when the screen has one (rule 6 never decays it).
- **Owed, not done: browser verification.** Nobody has opened an agent page over a real trust
  dialog and seen the question, both options and the highlight. The browser gate was held by
  another agent during this build. The card stays open at "words shipped and mechanism built,
  behaviour not yet measured" until that walk happens; it is listed in the PR body.

## Challenge-loop iteration 2: one claim narrowed, one surface named

- **"No web change" was wrong in one respect.** `stateEvidence` is generic (status.js maps
  `evidence` for any state) and the agent page renders it under "X's screen said:" through
  `textContent`. So the agent page WILL now show the trust question row, through a renderer
  that already exists. That is the card's ask, and it is unverified in a browser (the walk
  above is still owed).
- **The frame tolerance is inherited, not observed.** The detector uses `authFailed`'s left
  strip and `optionsIn`'s right strip so both halves of the feature agree on what a row is.
  No box-drawn instance of this dialog has been observed; the framed test arms say so.
- Observed version named in the docblock: Claude Code 2.1.258, 2026-09-01. The
  bottom-of-screen rule was measured on that version; a later version that draws a footer
  under the confirm row would read unknown, which is the honest default and the thing to
  re-check on a version bump.

## Challenge-loop iteration 3: the invitation I created gets a refusal

- **Making the dialog needs_you made the page invite a typed answer**, and a typed answer ends
  with Enter, which on this dialog picks "No, exit" and ends the session. Delivery was never
  state-gated and both screen-moved guards go inert on unnumbered options. Two fixes, one
  floor and one fresh read: `chat.deliver` refuses from the roster snapshot (no capture) for
  every caller, and the two person-typed routes read a fresh screen through `trustDialogHold`
  and answer 409 naming what Enter would have done. One capture per send, shared with the
  button guards, because five existing arms feed the tmux seam one answer per capture.
- **Reported needs_you plus the trust screen: the screen leads.** The report's question is the
  conflict sentence, not dropped; the project it named still rides on the state.
- Comments corrected: the wrap is Claude Code's own, which `-J` cannot join; "closed" means
  closed on every observed shape; the reconcile test is titled for the fresh report it uses.
- Server arms added: the thread page shows the dialog and offers no buttons; the roster card
  carries the row and the default-answer reason; both routes refuse; an ordinary question is
  still answerable (control).

## Challenge-loop iteration 4: a measurement I had skipped

- **The raw capture, not a fixture.** On a real 60-row pane the dialog sits in rows 8 to 17
  and tmux pads 43 blank rows under it; the shared 25-row tail was all blank and the shipped
  classify read unknown. I had only ever fed classify a hand-made fixture. Fix: the trust
  detector trims its own tail (trailing whitespace only) before taking 25 rows; the other
  rules keep the untrimmed tail, with a control arm proving an answered question high in
  scrollback does not become live.
- **Reported needs_you plus the trust screen now uses the rule 3 shape**, `reported: false`,
  because the page renders a reported sentence in quotes as the agent's own words and this
  sentence is the screen's.
- Comment corrections: evidence is written by several states and it is the needs_you pairing
  plus the anchored question that disambiguates; the union marker has two readers in chat.js
  (finder and menu parser); the "different question" is stated as the inference it is; the
  deliver refusal sets paneState null like its neighbours. Card lookup deduplicated; the
  project route filters on isNamedOurs like the agent route. Arms added: capture failure
  falls through to the deliver floor; snapshot-vs-fresh disagreement refuses benignly;
  project-route control.

## Challenge-loop iteration 5: say it before they type

- **The page now says, before anybody types, that this answer belongs in the terminal.** The
  thread routes send `answerNote` (the one exported `TRUST_DIALOG_SENTENCE`, shared with the
  deliver refusal and the 409) when the trust dialog is on the screen; both "waiting on an
  answer" labels (agent page, project room) show it, through textContent. Null for every
  other question, so the label is unchanged there. A static page test pins both sites; the
  browser walk over a real dialog is still owed.
- **The residual, stated where it lives:** a dialog that draws in the gap between the roster
  snapshot and the send, on an agent the snapshot did not call needs_you, is seen by neither
  the route hold nor the deliver floor. One request cycle. Closing it costs a capture per
  send to every agent; not taken. A screen already in hand is read whatever the snapshot says.
- The hold takes a capture thunk, so one-capture-per-send is visible at the call site. The
  reach boundary for the full dialog shape is measured and pinned: seen with the first option
  at row +11, lost at +12.

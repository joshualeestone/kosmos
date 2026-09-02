# kosmos#1919: an agent parked on the Bypass-Permissions consent renders as UNKNOWN

Branch: `bypass-consent-needs-you-1919` (joshualeestone/kosmos, local ~/work/agent-workforce)
Card: kosmos#1919. Splinter routed it; DECIDE-before-build agreed with him.

## The defect (as filed, verified in the engine)

A real external tester created an agent on 0.6.22; it never started. Its terminal is
parked on Claude Code's "Bypass Permissions mode" consent prompt, waiting for a keypress,
with `No, exit` the highlighted default. The board renders it as "? Can't tell", "never
reported", "cannot tell where it is running" - UNKNOWN about a state that is fully
determined and SITTING IN THE PANE THE BOARD IS ALREADY READING.

Two independent root causes, neither sufficient alone (Splinter's read, confirmed):

- ROOT A (READ side, the durable fix): `engine/status.js` has NO detector for the bypass
  consent dialog. The generic option-line scan (`asksSomething` / `OPTION_LINE`) reads an
  UN-trimmed 25-line tail, but this dialog sits at the TOP of a fresh pane with tmux blank
  padding beneath, so the tail is blank and it falls through to UNKNOWN. `trustPrompt`
  (status.js ~2021) already solves this SAME "dialog at the top of a fresh pane" problem
  for the trust dialog by reading a TRAILING-TRIMMED tail - it was just never generalized.
  CORRECTION to the exploration: the bypass options are UN-numbered (`❯ No, exit` /
  `Yes, I accept`), like the trust dialog, so `OPTION_LINE` (numbered `❯ <digit>.`) cannot
  catch it. The general key is the shared consent chrome, not numbered option lines.

- ROOT B (LAUNCH side): creation pre-writes folder-trust (`trustFolder` ->
  `.claude.json` hasTrustDialogAccepted) but has NO equivalent that pre-accepts the
  bypass-mode consent. The supervisor already passes `--dangerously-skip-permissions`
  (agent-supervisor.sh:408); that flag needs a one-time interactive acceptance the first
  time it runs in a config dir, and the supervisor launches non-interactively, so a new
  agent lands on the consent. Acceptance key = `skipDangerousModePermissionPrompt: true`
  (per the bypass-mode-warning-acceptance bulletin, authoritative).

## Scope of this PR: ROOT A (read side). ROOT B is a tracked follow-up PR.

The read side is the durable deliverable (a shipped/Codex/Windows agent, or a mid-session
prompt, must all read as waiting-for-input, not unknown). It is self-contained
(status.js + status.test.js). ROOT B (a config writer parallel to trustFolder) is a
separate concern and a follow-up PR referencing the same card. Both leave #1919 open.

## The read-side design: recognize the SHAPE, not one banner (Splinter, approved on record)

Add a GENERAL consent/selection-dialog detector to `engine/status.js`, parallel to
`trustPrompt`, inserted in `classify` right AFTER the trust check (~status.js:2333) and
BEFORE `asksSomething`, reading the same trailing-trimmed `trustTail`.

It keys on the shared Claude consent chrome, so it catches the bypass dialog, the trust
dialog, and the next unforeseen confirm dialog (named dialogs are evidence-LABELERS on
top, not the detection key):
- The dialog must END the screen (last non-blank row is a dialog row) - the paste-vs-live
  discipline `trustPrompt` already uses.
- A confirm footer (`Enter to confirm`) OR a `No, exit` + `Yes, ...` option pair.
- Maps to STATE.NEEDS_YOU with the heading/option row as evidence.

Why this is safe (Splinter's negative-control requirement - the load-bearing part):
THE ORDINARY CLAUDE COMPOSER IS ALSO `❯`. The detector must NOT flip an idle composer.
It does not, because the composer has no `Enter to confirm` footer and no `No, exit`
option, and its bare `❯` strips to nothing (so it is never the screen's last dialog row).
Default toward needs_you (a false "waiting" costs a glance; a false "can't tell" cost Ben
an hour), but BOUND it with negative controls.

Also add the detector's marker to `ALL_NEEDS_YOU_MARKERS` so chat.js's question finder can
surface the question text and a way to answer it.

## Tests (control-bearing, per Splinter - required, not nice-to-have)

In `engine/status.test.js`, mirroring the `#1629` trust-dialog block (~3755-3834):
- POSITIVE: a verbatim BYPASS_CONSENT fixture (ending `❯ No, exit` / `Yes, I accept` +
  `Enter to confirm`, with trailing blank padding reproducing the fresh-pane tmux gap) ->
  `classify(...).state === NEEDS_YOU`. FAILS today (renders UNKNOWN) - the control that
  returns the dangerous answer.
- NEGATIVE: an ordinary IDLE pane at its normal composer -> NOT needs_you. Passes today,
  MUST STILL PASS.
- NEGATIVE: a pane MID-WORK (spinner / tool output) -> NOT needs_you.
- Direct-detector unit tests (the detector returns the evidence row; a PASTE of the dialog
  above a live composer does not match), mirroring trustPrompt's own tests.

## Condition 3 (destructive default), stated honestly on the card
`No, exit` being the highlighted default is UPSTREAM Claude Code, not ours to change. Our
mitigation is the pair: never land on it (ROOT B), and if one is ever met, surface it
(ROOT A). Do not imply we can change the upstream default.

## Checklist
- [ ] `engine/status.js`: general consent detector + insert in classify after trust +
      marker into ALL_NEEDS_YOU_MARKERS.
- [ ] `engine/status.test.js`: positive fixture (fails today) + 2 negative controls +
      direct-detector unit tests.
- [ ] Run the suite; the positive arm goes from red (pre-change) to green (post-change),
      the negatives stay green throughout.
- [ ] No em dashes. challenge-loop -> proof -> create-pr (Addresses kosmos#1919, no auto-close).

## Out of scope (this PR)
- ROOT B launch-side pre-accept (follow-up PR, same card).
- Any change to Claude Code's upstream dialog or its default.

# waitresume-9049: a /clear or a resume after a quit reminds the agent of its own wait (kosmos#9049)

## Problem (from the card, found while measuring #9011)
On Claude, `SessionEnd` records `stopped` (automatic), which lands over the agent's own needs_you or blocked on the
board. Two paths then continue the SAME conversation with no `started` (#1058 allows `started` only at
`source: startup`):
- `/clear`: SessionEnd, then SessionStart `source: clear`;
- a resume after a clean quit: SessionEnd, then SessionStart `source: resume`.
#8634's reminder ("you last reported you were waiting") is asked only after a recorded `started`, so neither path gets
it: the board has dropped the question and the agent is not told.

## Decision
The card's first option: give the reminder at SessionStart `clear` and `resume`, the wait only, no digest replay (that
conversation already saw what arrived).
- Board: `GET /api/away?wait=only` answers only `awaydigest.lastWait`, worded without naming a cause ("The board has
  since set that waiting report aside") instead of #8634's "A new run replaces ...". It answers only
  when a `stopped` was recorded after the wait (`awaydigest.endedAfter`), so a resume after a CRASH (no SessionEnd,
  the wait still on the board) is not told something false.
- CLI: `kosmos away --hook --wait-only` (the --hook contract: JSON or nothing, exit 0, 1 s cap). `--wait-only` alone
  is a usage error.
- Mac bash hook (install/kosmos-report-hook.sh) and Windows JS hook (engine/kosmos-report-hook.js): at SessionStart
  `clear` or `resume`, with an agent token (or, on the Mac, a pane), ask and print the JSON. Still no `started`.
  `compact` sends no SessionEnd, so the wait is still on the board and nothing is asked.
- Review round 1: on the Mac a /clear can beat its own `stopped` (the SessionEnd hook sends it in the background, and
  the clear's SessionStart follows at once), so an empty first answer at `clear` is asked once more after 0.8 s
  (KOSMOS_WAIT_RETRY_S). A resume follows its quit after a person's pause and is asked once; the Windows hook awaits
  its SessionEnd send, so it does not race.

Rejected:
- The card's second option, keeping the wait across a SessionEnd that a resume follows: the board cannot know at
  SessionEnd whether a resume will follow, so it would have to keep every wait across every end, which shows a stopped
  agent as waiting.
- Sending `started` at clear/resume and relying on #8634: it would erase the wait (#1058's whole point).
- Reusing the startup wording: "a new run replaces" is false here; no new run happened.

Weakest premise: that `lastWait` still finds the wait after SessionEnd. It skips rows with `by: 'auto'`, and both
hooks send `stopped` with --auto / auto:true (measured in the tests: a needs_you, an auto idle, an auto stopped ->
reminded).
Not exact, accepted: `endedAfter` asks whether ANY `stopped` follows the wait, not this conversation's. So a resume
after a crash IS reminded when an earlier quit's `stopped` sits after the wait (wait, quit, startup, crash, resume).
The reminder stays true there (the board does not show the wait), which is why the wording names no cause.
Not covered: Grok and Gemini bridges, which send `started` on every SessionStart (#9048, a separate card). A real
Claude Code /clear and resume on a live agent were not driven; the hooks were fed the events.

## Tests
- server.away-9049.test.js: ended wording after a stopped (hook, JSON and text forms), no digest, no report words;
  nothing without a stopped (crash-resume), with the startup path's control; nothing for an ended wait or no wait.
- engine/awaydigest-9049.test.js: the ended wording and endedAfter.
- engine/kosmos-report-hook.waitresume-9049.test.js: Windows hook at clear/resume (asks wait=only, prints, no report),
  compact and no-token ask nothing, startup control.
- report-hook-away-8548.test.js: the Mac hook's clear/resume now ask `away --hook --wait-only` (this changed the old
  "a compaction or a resume asks nothing" test, split in two), an older CLI's refusal is dropped, the person's own
  session is not asked.
- cli.away-8548.test.js: --hook --wait-only's URL; --wait-only alone is a usage error.
- Mutants: the board ignoring endedAfter, the bash hook never asking, the JS hook never asking: each fails one test.

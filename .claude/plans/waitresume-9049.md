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
- Board: `GET /api/away?as=waithook` (the hooks' form; `wait=only` gives the same answer as JSON or text by hand)
  answers only `awaydigest.lastWait`, worded without naming a cause ("The board has since set that waiting report
  aside") instead of #8634's "A new run replaces ...". It reminds only when the NEWEST session event after the wait
  (`awaydigest.sessionAfter`: a `stopped` or a `started`) is a `stopped`:
  - `stopped`: a session end set the wait aside, so remind (every /clear does this, and each wipes the context that held
    the last reminder);
  - `started`: a startup came after it and #8634 reminded there, so say nothing (a crash-resume after it too);
  - none yet: answer `{"pending":true}` (a /clear's own `stopped`, sent in the background, has not landed; or a crash
    left the wait shown). Never a reminder, so nothing false is said.
  `as=waithook` is new, so a board older than this answers it with plain JSON, which the hooks drop: never the startup
  digest nor its "a new run replaces" sentence.
- CLI: `kosmos away --hook --wait-only` (Mac and Windows) asks `as=waithook` and prints the hook JSON, or
  `{"pending":true}`, or nothing; exit 0, 1 s cap. `--wait-only` alone is a usage error.
- Mac bash hook and Windows JS hook: at SessionStart `clear` or `resume`, with an agent token (or, on the Mac, a
  pane), ask; on `pending`, ask once more after 0.8 s (KOSMOS_WAIT_RETRY_S on the Mac); print only the hook JSON. Still
  no `started`. `compact` sends no SessionEnd, so nothing is asked. The retry is paid only on `pending`, so an ordinary
  /clear with no wait costs one ask.

Rejected:
- The card's second option, keeping the wait across a SessionEnd that a resume follows: the board cannot know at
  SessionEnd whether a resume will follow, so it would have to keep every wait across every end, which shows a stopped
  agent as waiting.
- Sending `started` at clear/resume and relying on #8634: it would erase the wait (#1058's whole point).
- Reusing the startup wording: "a new run replaces" is false here; no new run happened.

Weakest premise: that `lastWait` still finds the wait after SessionEnd. It skips rows with `by: 'auto'`, and both
hooks send `stopped` with --auto / auto:true (measured in the tests: a needs_you, an auto idle, an auto stopped ->
reminded).
How the rule got here (review rounds 1 to 3): a first version retried every empty answer at a /clear (nearly every
/clear paid 0.8 s), gave a resume no retry although an in-session /resume races the same way, accepted any later
`stopped` (so a crash-resume after an earlier quit was told), and then a `started` rule that could lose the reminder
for good (wait, quit, startup, /clear before a new report). The newest-session-event rule above replaces all of these.
Accepted: when the board answers `pending` because the agent crashed with a wait shown, the hook pays the 0.8 s retry
once; worst case about 3 s (two 1 s asks and the pause), inside the hook's 15 s.
Not measured: whether Claude Code waits for the SessionEnd hook to finish before the next SessionStart (on Windows the
hook awaits its send, so it would then not race; the retry covers it either way).
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
- cli.away-8548.test.js and tools.windows-kosmos-cli-away-8548.test.js: --hook --wait-only's URL on both CLIs;
  --wait-only alone is a usage error.
- Mutants: the board ignoring endedAfter, the bash hook never asking, the JS hook never asking: each fails one test.

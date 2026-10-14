# idle-report-5949: a non-Claude Windows agent says idle when its turn ends (kosmos#5949, root cause)

**Posture:** production

## Problem
On Windows every Codex, Grok, Gemini and Antigravity agent read "Can't tell" five minutes after each turn, with the
reason "it said it was working and has not said anything since; we could not check" (found on Josh's machine,
2026-10-12 10:28 CDT, card comment). Their last report was the automatic `working` from the turn's start. Their
supervisor (engine/win32codexsup.js) wrote idle to the agent's win32-state file when the turn ended, but sent no idle
report, and the board, once the working report was older than REPORT_WORKING_DECAY_MS (5 min), ignored the state
file's idle (classify's win32 arm reads it as scraped IDLE) and fell to UNKNOWN. Claude agents are unaffected: their
Stop hook reports idle. Codex has no turn-end hook at all. Gemini, Grok and Antigravity DO have hook bridges that report
idle at turn end (bin/gemini-report-bridge.js AfterAgent, bin/grok-report-bridge.js Stop, bin/agy-report-bridge.js Stop),
yet on Josh's machine their idle did not land either. Why is not found here (this box has no such agent); the likeliest
is the hook dying with the turn's process tree when the turn ends. Finding that is a follow-up; this change does not
depend on it, because the supervisor itself knows the turn ended.

## Change
1. engine/win32codexsup.js (two insertions, no existing line changed): when a turn ends normally (`r.ok`) with nothing
   queued behind it, the supervisor sends an AUTOMATIC idle report, through the same writer Claude's Stop hook uses on
   Windows (engine/kosmos-report-hook.js `main` with a `Stop` event: `report idle --auto "finished responding"` to
   /api/report, with this run's own agent token from the turn environment). Nothing on a failed or thrown turn (that
   is #5948's to report) and nothing while a message is queued (the next turn starts at once). Never awaited, never
   throws. It is skipped when the agent's own hook already reported idle during this turn (its latest report is idle
   and newer than the turn's start), so a bridge's idle with the agent's last words is not replaced by "finished
   responding". The default sends nothing inside a test (live-execution.inTestRun, the one copy of the --test /
   NODE_TEST_CONTEXT pair, now also used by win32job.js and agystatus.js); `opts.reportIdle` and `opts.lastReport` are
   the seams.
2. engine/status.js: classify's win32 arm marks its idle as `liveToken: true` only for a per-turn runner
   (win32codexlive.PER_TURN: codex, gemini, grok, antigravity), whose idle is the supervisor's own record that no turn
   is running. Not for a Windows Claude agent: `claude agents --json` also reads idle while a session waits (#570). In reconcileReport, a stale working report over a `liveToken` idle reads IDLE
   instead of "we could not check". A Mac screen that merely looks idle still falls through to the honest unknown.
   This is the backstop for an idle report that did not land (board restarting, a refused send).

## Composes with #5948
#5948 (another agent, same supervisor) writes a blocked self-report on a sign-in failure and a non-automatic
working/idle when a turn succeeds after being signed out. This sends only an automatic idle, only on a normal end, and
selfreport refuses an automatic idle over a standing blocked (pinned in the new test), so the two merge in either order.
Lines touched in win32codexsup.js (insertions only, no existing line changed): after `const supervisorPid = ...` (the
`reportIdle` and `lastReport` seams), one line after `stream.wrote();` in pump (`const turnAt = Date.now();`), and
between `turning = false;` and `pump();` in the turn's `.then`.

## Tests
engine/win32codexsup.idle-5949.test.js (12; selected for the Windows CI job by its name): one idle report per normal
turn (after the state file went idle, with the run token); none when the agent's own hook already said idle this turn
(but yes for an idle from before the turn, or an unreadable report); none on a
failed or thrown turn; none between two queued turns; a throwing or rejecting sender never stops the supervisor; the
REAL default sender, in a child process that is not a test, posts `{state:'idle', auto:true}` to /api/report on a fake
board with the agent token, store root a throwaway folder; under a test the default sends nothing; end to end through
status.snapshot a codex agent with a stale working report and an idle state file reads Idle (busy still Working); a
Windows Claude agent reading idle and a Mac-shaped idle screen still read unknown (the Claude one fails if liveToken is
set for every runner, checked); an automatic idle is refused over a standing blocked (an existing selfreport rule,
pinned because #5948 relies on it).

Validation: targeted preloaded node tests only (the full suite is not run on this box without the schtasks preload):
the files above plus win32codexsup, status, win32capture, win32roster, win32codexlive, kosmos-report-hook, selfreport,
win32supervisor, engine.reachable, fixture-discipline, one-derivation, the test inventories and the golden card. Same
18 failures as origin/main on this box (tmux and #5548 inventory, all pre-existing), none new.

## Weakest premise
That the automatic working at a turn's start is the only report these agents make. If an agent itself reports working
by hand mid-turn, the idle at the end still lands (an automatic idle may replace a working); if it reports needs_you or
blocked by hand, the idle is refused, which is right. I could not run a real Codex agent: this box has none.

## Not in this PR
The remembered-state work (hold through failed looks, after a board start, the reason logged and on hover) is the
second PR, branch cant-tell-hold-5949.

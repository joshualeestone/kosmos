# redisable-7409: a removed agent stays off after a machine move

Card: kosmos#7409 (an outside user's issue list, 0.7.70). Claimed by Mona Lisa on Splinter's routing.

## Done means
- On a Mac moved with Migration Assistant, an agent the person removed does not keep running: the board, at start,
  gives it removal's own steps again (its startup job disabled and unloaded, and its running session ended when the
  board can tie it to the agent), and says so on the board's log. Restore still puts it back.

## Cause (from engine/remove.js)
Removal is three steps: `launchctl disable` (kept in launchd's own per-machine database, never in the plist),
`launchctl bootout`, and ending the agent's tmux session, which the launchd job does not own. Migration Assistant copies
~/Library/LaunchAgents and Kosmos's own data (the removed list included), not launchd's database, so on the new Mac the
plist loads at login, enabled, and its supervisor starts the agent's session again.

## Change
- `engine/remove.js` reapplyRemovedDisables (Mac only; nothing in a dry run, `commandsAreReal`):
  - reads the removed list with readRemovedForWrite, so an unreadable one does nothing and says so;
  - takes only a label removal itself would record for the record's own name: create.serviceLabel(name, this Kosmos),
    or in the default Kosmos the legacy com.<name>.discord. removed.json is a file a person can edit, so any other
    label is never touched;
  - asks `launchctl print-disabled gui/<uid>` once, runs every job step first, and only then reads the board's roster
    once (review 5: read before, a supervisor starting its session at login could slip past the snapshot); for each such label launchd does not hold disabled (`=> disabled` or
    `=> true`), runs `disable` and `bootout` (code 3, "not loaded", counts as done), then ends the agent's session only
    when the roster ties it to the agent (FOUND.OURS), as removeInner does;
  - for a label launchd already holds disabled, still runs `bootout` (review 3: a session ended while its job is still
    loaded is started again by KeepAlive), and only then ends a session the roster ties to the agent (review 2: one
    missed at login is otherwise never looked at again);
  - skips a record the person chose to leave running (leftRunningByChoice: the untied override's promise) and any name
    removal itself would refuse (unsafeToActOn: a path step, a leading dash, another Kosmos's separator);
  - review 7: bootout returns before the job has stopped (#4964 measured 4.5 s), so a job this run unloaded is waited
    on (waitUnloaded) before the one roster read, for up to 25 s each but never past the shared burst allowance (30 s
    of waiting in any 60 s, spent by restarts too): with the allowance spent it does not wait at all, and the retry is
    then what catches a late session. Its answer (still held when the wait ran out) is not acted on: the job is
    disabled and booted out either way, and a session it leaves is a recheck. A session a
    supervisor was starting can still land after the read; a job this run unloaded with no session on the roster is
    reported `recheck`, which makes the run not clean, so the 30 s retry looks again. On the retry the job is disabled
    and not loaded (bootout answers 3), so a session found then is ended and none is a recheck. That is how the
    bootout-to-roster race is handled: the wait narrows it, the retry closes it for a session up within 30 s;
  - reports names: reapplied (a job step or a session ended changed something), failed (launchd or tmux refused a
    step), unsure (a session it could not tie to the agent, or could not ask tmux about, left alone as removal leaves
    it; reported on EVERY run, review 7, even one a removal already left), recheck (above).
- `engine/remove.js` reapplyAtBoardStart: a real board (`enforcing`; a sandboxed fixture never is) runs it 2 s after
  start, and once more 30 s later only when the first run was not clean (a board up before the login session answers),
  and writes what it did to the board's log (stdout, stderr). A recheck still open is named only by the last run. `server.js` onListening only calls it.
- `engine/remove.redisable-7409.test.js`: through remove.setRunner (every launchctl and tmux call recorded), a sandboxed
  removed.json, and the board's roster from test-support/fleet.

## Decided
- Re-apply at board start; nothing is written into the plist. Rejected: the plist's own `Disabled` key, or moving the
  plist aside, as the card suggested: each is a file change Restore would then have to undo, and the record Kosmos
  already keeps (removed.json, which travels) is enough to re-apply the steps Restore undoes.
- The session is ended only when the board ties it to the agent, and only after launchd accepted both job steps;
  otherwise it is reported and left alone, the same rule removeInner keeps.
- Weakest premise: after a move, the agent runs from the first login until the board starts (a few seconds after
  login, then 2 s). A plist key would close that window, at the cost above.
- A Restore that started the agent but could not take it off the removed list (writeRemoved threw; the person is told
  it was only partly done) leaves the record, so the next board start switches it off again. Accepted: it needs a
  failed write, on the path that already told the person it was half done.
- It runs on the board's thread, synchronously: one print-disabled, one roster read, and a bootout for every owned
  label (a disable too for one launchd does not hold disabled), so N removed agents cost N launchctl calls on every
  start. A launchctl that gives no answer (a timeout) stops the sweep, with the rest reported failed, so a launchd that
  is not answering costs one wait, not N. Not moved to the async driver.
- bootout of a job launchd does not hold answers 3 ("No such process"), MEASURED 2026-10-27 on macOS 27.0.1; that is
  the only code read as "not loaded", as MAC_STEPS.stopNow reads it.
- One retry, 30 s after the first run, only when it was not clean; after that, nothing until the next board start.
- On every board start, not only after a move, a removed agent whose job is still loaded is unloaded and its tied
  session ended. That finishes a half-done removal too (one whose bootout failed at the time), and switches off again an
  agent a person re-enabled by hand with launchctl: the board cannot tell that from a move, and the record says removed.
- A launchd that does not answer at login can stall the board's thread on print-disabled (execFileSync, up to 20 s);
  accepted for one call at start, with the 30 s retry behind it. Worst case on a slow launchd (review 8): that 20 s,
  plus up to 30 s of unload waits (the burst allowance), plus a bootout's own timeout, one time per start (twice with
  the retry). A launchctl that times out on a step ends the sweep.
- Not tested (review 8): server.js's one call (reapplyAtBoardStart with enforcing taken from the live-execution gate,
  after listen). Its logic is reapplyAtBoardStart's, which is tested; only the one line of wiring is not.
- An untied session is named on the log on each run (so twice, 30 s apart, when the first run was not clean) and on
  every start. Accepted: repeated, never silent.
- Only bootout code 3 is read as "not loaded" (measured on macOS 27.0.1). If an older macOS answers another code for
  a job that is not loaded, that agent is reported failed on every start and nothing else is harmed.
- Review 7: a session the board ties to a removed agent is ended on EVERY start, including one a person started
  again by hand in tmux. The record says removed, and the board cannot tell that session from one a moved login
  started. An untied session is never ended, and is named on the log on every start.
- A session that comes up more than ~30 s after the bootout (past the retry) is not caught until the next board
  start. Accepted: the supervisor is unloaded, so nothing should start one after the bootout; the case is a session
  already starting at the bootout.
- What it does is said on the board's log only. Not done here: a notice on the board for a failed or unsure agent.

## Mutation checks (run by hand, code restored after each)
- The session not ended: the moved-agent case goes red.
- Any launchd-shaped label accepted (no ownership check): the hand-edited-list case goes red.
- No dry-run guard: the review-5 dry-run case goes red (live execution armed, no runner).
- No real-board gate: the board-start case goes red.
- An already-disabled agent's session not looked at: the review-2 recheck case goes red.
- No second try: the board-start case goes red.
- No bootout for a job already held disabled (round 3's blocker): the retry case goes red.
- No leftRunningByChoice skip, or no unsafeToActOn skip: the kept-or-unsafe case goes red.
- A label launchd already holds disabled not skipped (first round): the already-disabled case goes red.
- Round 7, run 2026-10-27 22:3x, each red, engine restored byte for byte after each (cmp):
  - no recheck for a just-unloaded job with no session: four cases go red (not-running, review 4, both review-7 retry
    cases);
  - an ended session not counted as reapplied: five go red (the moved-agent case, review 2, review 3, ...);
  - the roster read before the job steps: the review-7 order case goes red;
  - an untied session skipped silently when launchd already held the job off: the review-2 case goes red;
  - the open recheck named by the first run too: the review-7 board case goes red.
- Round 8: no wait before the roster read (the waitUnloaded line deleted): the review-8 wait case goes red (before it,
  all 20 cases passed with that line deleted, the reviewer's finding).

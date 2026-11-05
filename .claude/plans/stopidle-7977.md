# kosmos#7977: a lost turn-end report leaves an idle agent reading "Can't tell"

## Measured (11-04, this board, read-only)
Irma's card: state unknown, "it said it was working and has not said anything since; we could not check"
(status.js:8733, the deliberate Mac honest-unknown). Her selfreports end `working, auto, 18:07:00Z`; her Stop hook ran
at 18:08:18Z (transcript stop_hook_summary, 304 ms, no hook error) and no idle arrived. report() discards all output,
so the cause of the lost send is unrecorded. Vivienne shows the healthy pair (working, idle 10 s later).

## Finished looks like
The Stop hook's idle report runs detached (the hook never waits on it). If the board did not answer, it is tried once
more, but a retry is not STARTED once another hook event of the same pane came after the Stop (a per-pane STOP_TOKEN
every other event removes); a retry already sending can still land after a newer report, as the single send always
could. Only the board's deliberate keep (an agent waiting on a person or its provider; every such answer says the idle "did
not overwrite" it, selfreport.js skipped:'waiting') is neither retried nor noted; every other failure, including a
"not recorded" for another reason (a failed save), is retried and noted. A second
lost send writes one line (time, pane, exit code, the CLI's first line; no command text) to
$THROTTLE_DIR/turn-end-failures.log. Only an agent's pane (TMUX_PANE set) gets the retry and note: the person's own Claude sessions run this hook too
(shared settings) and are refused every turn, so they keep the single send. Kosmos not running is retried but not noted
(final classification below); the note file is capped (past 400 lines,
the last 200 kept). Weakest premise: a person's own session inside tmux is treated as an agent. Every other report is unchanged. The Windows node hook is out of scope (the
symptom is the Mac board's honest-unknown).

## Call
Retry plus a note in the hook. Rejected: letting an idle screen outrank a stale working report on a Mac (the fleet-wide
precedence change status.js already raised rather than took); counting a placed delivery as life.
Weakest premise: that the five family-board agents (non-Claude runners) fail this way; their selfreports would show it.

## Measured on the branch
report-hook-turnend-7977.test.js 11/11 (+ a refusal: no retry, no note) (+ no pane: single send; Kosmos not running: no retry, no note): (1) a send that goes through is sent once, no note; (2) the hook returns at once
while the send takes 2 s; (3) a send the board never answered is retried, a landing retry leaves no note; (4) the
board's deliberate keep ("did not overwrite") is neither retried nor noted; (5) a newer event of the pane cancels the
retry; (6) two lost sends leave one line (time, pane, exit code, the CLI's first line, its indent stripped); (7) a
"not recorded" for another reason (a failed save) IS retried and noted; (8) the hook's phrase is bound to every
skipped:'waiting' answer in engine/selfreport.js. Mutants, each red on its own test: token check removed, the skip
removed, output held open, the old broad 'not recorded' match restored.
report-hook-auto-1453.test.js counts report_turn_end as a report call (floor 8). The other ten hook test files (five report-hook-*, five engine/kosmos-report-hook*) pass.

## Final classification (review round 7, against the board's real answers)
- No retry, no note (a retry cannot change it): the deliberate keep ("did not overwrite", selfreport.js skipped:'waiting')
  and a pane the board cannot tie to an agent ("could not match that to one of your agents", "cannot tell which agent",
  engine/messages.js).
- Retried, not noted: "Kosmos is not running" (a board mid-restart reads so, the likeliest loss; Kosmos closed is noise).
- Retried and noted: everything else, including "Kosmos refused that" (the report route's catch-all, possibly a one-off
  fault) and any other "not recorded" (a failed save). report-hook-turnend-7977.test.js 12/12, fixtures in the real wording,
  a test binding every phrase to its source.

## Round 8 (the cap) fixes, applied after the last blind review (NOT blind-reviewed)
- A board too busy to answer ("too busy to answer", install/kosmos #4466): not retried, noted at once, so a stall gets
  no second Stop send from every pane. Rejected: also not retrying "not reachable"; that is the board-mid-restart loss
  this card exists for.
- More deterministic refusals in _TE_KEEP: "could not tell which agent that was", "does not look like something we can
  identify you by" (engine/messages.js), "from the account that started it; run" (server.js report route, #1946). The
  binding test now requires every _TE_KEEP phrase to have a named source file that still contains it, and pairs each
  skipped:'waiting' object with its own because.
- A duplicate idle (a send that timed out after the board acted, then retried) is safe: toolloop.noteTurnEnd returns
  once turnEndAt is set; roomhold.flushOnIdle tells only what is still held. Stated in the hook comment.
- Comment fixes: the no-pane sentence (no pane never writes a token; the shared-key case is two tmux servers' %N).
- Tests: the no-wait bound widened (send 4 s, ceiling 3 s); a busy test, an other-account test, a two-Stops test.
  report-hook-turnend-7977.test.js 15/15; all eleven hook test files 378/378. Mutants red: busy branch disabled (busy
  test), account phrase dropped from _TE_KEEP (binding + account tests).

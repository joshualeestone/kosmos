# #6209 part 2: a direct prompt when the running summary is overdue

## Finished looks like
An idle Claude agent whose newest summaries/YYYY-MM-DD-HH.md is older than the four-hour rhythm AND that has reported
more than the rhythm of work since it (workedSinceMs, positive evidence only) is told ONCE, typed into its session, instead of the
staleness showing only inside project status. An idle agent, one with a current summary, one with none, one mid-turn
and a non-Claude agent are not told.

## How
- engine/summarydue-nudge.js, modelled on engine/stalereport-nudge.js (#5959): a pure planner, injected reads (folder via
  create.workerDir, history via selfreport.history, screen via stalereport-nudge.screenOpen, pause, delivery), once per
  stale summary kept on disk (summarydue-prompted.json, keyed on the newest summary's write time), MAX_TRIES 3.
- Wired in server.js beside the stale-report sweep: live-execution gate, operator brake
  AGENT_WORKFORCE_SUMMARYDUE_NUDGE_OFF=1, own timer (10 minutes, AGENT_WORKFORCE_SUMMARYDUE_NUDGE_MS), unref'd,
  delivered through chat.deliverAutomatic (pinned in server.agyhold-4588.test.js).
- Words follow the role's own (roles.js SUMMARY_RHYTHM): where the file goes and what goes in it.

## Decided
- Only a stale summary with more than the rhythm of reported `working` since (workedSinceMs; review 1 replaced workExcused) is owed: a stale file alone is a fact, not a fault (an idle agent is not expected to
  write). An agent with no summary file at all is not told (a role without the rhythm never writes one).
- Claude only, idle only: the screen readers that keep a typed line out of an open menu know Claude Code's screens.

## Weakest premise
That reported work is a fair measure: only REPORTED busy time after the summary counts (a missing or cut history, no
known state at the summary, or no busy report after it reads as no work), so an agent whose reports were lost is not
told, and one whose reports overstate work is told early.

## Review 1 (opus), and what changed
- Fixed: workExcused leaves a summary stale whenever it cannot tell (the right bias for a status line, the wrong one for
  a typed line), so a missing history, an empty one, or a state carried across a crash read as days of work. Replaced by
  workedSinceMs: positive evidence only (unknown start state is not busy, a missing or cut history is unknown, and at
  least one busy report after the summary is required). The message states the reported work instead of claiming it.
  Tested; both rules fail their test when removed (measured).
- Tests added: the on-disk record stops a repeat after a restart; failed deliveries retry and stop at MAX_TRIES; paused
  and channel-reached cards are skipped. The record keeps heldSaidFor and screenSaidFor as the model does.
- Decided, stated gaps: project status also re-labels a stale summary "quiet" (quietExcused) or "idle"; the nudge does
  not, so it can tell an agent whose task parts all closed but whose room or DM turns added up to the rhythm (that is
  still unwritten work). An agent that never wrote any summary is not told (follow-up if wanted: use roles.js
  NO_SUMMARY to tell agents with the rhythm and no summary at all).

## Review 2 (sonnet), and what changed
- Fixed: nothing after the last report counts as work. An interrupted or crashed turn sends no Stop, so its last busy
  report would have run to now (days, on an idle card). A working Claude agent reports busy on every tool call, so this
  costs at most the time since its last call. Tested (counting the trailing stretch fails it, measured).
- Tests added: a cut history is unknown; an operator clear is not the agent's report (as workExcused); a held delivery
  spends no try; the tick reads nothing when live execution is off. Module header names the quiet/idle gap.

## Review 3 (opus), and what changed
- BLOCKER, fixed: a history cut short after the summary returned unknown, but selfreport keeps only its last 64 KB
  (about 10 to 20 hours of a busy agent), so a days-stale summary on a working agent (the reported case) was never
  told. The cut tail now counts as a lower bound (start state unknown, so not busy); over the rhythm it is evidence.
- Fixed: only `working` counts as work; a wait (blocked, needs_you, an automatic provider block or permission prompt)
  does not. Both tested; restoring either old rule fails its test (measured).
- The not-told test has a positive control. Decided, stated (REVERSED in review 8): an agent that worked, then went idle for days, is still
  told when it next sits idle (its summary is still owed for that work), as project status also leaves it stale.

## Review 4 (sonnet), and what changed
- Fixed: each gap between reports counts at most WORK_GAP_CAP_MS (30 minutes): a working Claude agent reports at least
  once a minute, so an interrupted turn followed by a prompt days later is not days of work. Fixtures now use realistic
  heartbeats. Tested (removing the cap fails it, measured). A stale comment and a test title fixed.
- Stated: "once per summary" is permanent until a new summary: an agent that ignores the line, or whose delivery was
  unconfirmed, is not told again for that summary (as the #5959 model). A held or screen-blocked agent is looked at
  again every sweep (no try spent).

## Review 5 (opus), and what changed
- (REVERSED in review 6, see below.) Fixed: a new session (a `started` row) starts the count again, so the session told about the work is the one that
  did it (a restarted session may not remember earlier work, and would be asked to summarise it).
- The cap comment says "at most once a minute" (a single long tool call sends nothing until it ends, so the cap can
  undercount, the safe side; measured on real streams: one gap over 30 minutes after a working row).
- An agent already told about this summary is skipped before its history is read. A threshold test pins 3.5 hours (not
  told) against 4.5 hours (told). The plan's decision line and the server comment name workedSinceMs.

## Review 6 (sonnet), and what changed
- REVERSED review 5's session reset: zeroing the count at each `started` row meant an agent that restarts more often
  than the rhythm (common on a long day) was never told, the very case this exists for. Work now counts across a
  restart, and the words say "work has been reported on this card", not "you have reported": the summary belongs to
  the card, and a restarted session writes it from its handoff and the card. A rule that drew a finding the round after
  it was added was removed rather than patched.
- A card whose role is in roles.NO_SUMMARY is skipped (tested with a control; removing the skip fails it, measured).
- The tick logs a failed sweep once per reason, so a broken sweep is visible. Comments fixed (the heartbeat wording,
  only `working` counted).
- Kept, stated: one reminder per summary is permanent (a re-nudge interval would be a new rule; the #5959 model has none).

## Review 7 (opus), and what changed
- BLOCKER, fixed (measured by the reviewer on this machine's six busy agents): selfreport's default 64 KB tail is about
  350 rows, 9 to 21 hours, but only about 4 hours of counted `working`, so the rhythm was almost never crossed and 4 of 6
  day-stale agents went untold. selfreport.history takes an optional tailBytes (clamped to 64 KB..4 MB); this sweep reads
  1 MB (about ten days of a busy agent), only for an idle card with a stale summary it has not been told about. A test
  writes a real-density stream (a row every 2.4 minutes, a quarter working) through the real selfreport file, with
  controls that the default tail neither reaches the summary nor holds the rhythm; reading the default tail fails it
  (measured). My `beats` fixture had been far denser than real streams, which is why earlier rounds passed.
- REMOVED review 6's NO_SUMMARY role skip: a live card's `role` is the free-text label, never the role key, so it could
  not match (its test supplied the premise). A setup guide has no summary file and is skipped as `none`.
- Stated, not changed: an agent that files a deliberate wait and works on other things reports no `working` (selfreport
  refuses automatic heartbeats over a standing wait), so it is not told (errs toward silence). UNCONFIRMED counts as told.
- Focused list widened to every test that touches selfreport: 1809/1809.

## Review 8 (sonnet), and what changed
- REVERSED review 3's "worked, then idle for days, is still told": only an agent with a `working` report within
  RECENT_WORK_MS (24 hours) is told. A dormant agent is not woken to summarise old work, and the first sweep after an
  update no longer types to every agent that went quiet days ago with an untold stale summary (the record starts empty).
  Tested with a recent control; removing the rule fails it (measured).
- An agent given up on (MAX_TRIES) is skipped before its history is read. The history read (about 3 to 4 ms for 1 MB,
  measured by the reviewer) otherwise runs only for an idle card with a stale, untold summary.
- Comments state the rule without review labels; the selfreport note sits above history()'s own comment.

## Review 9 (opus): converged (nits only), and what was stated
- Measured on real streams by the reviewer: a continuously busy agent is told at about 8 to 12 hours stale, a lighter
  one after a day or more (counted `working` is about half of wall time). Errs toward silence; the six-day case is told.
- "Once per summary" keys on the file's write time, so touching the file without a real summary starts a new stretch
  (at most one extra line). Every delivery attempt is logged (at most MAX_TRIES lines a summary), unlike #5959's
  narrower log, so a summary that never reaches an agent is visible.

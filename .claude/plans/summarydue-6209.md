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
- The not-told test has a positive control. Decided, stated: an agent that worked, then went idle for days, is still
  told when it next sits idle (its summary is still owed for that work), as project status also leaves it stale.

## Review 4 (sonnet), and what changed
- Fixed: each gap between reports counts at most WORK_GAP_CAP_MS (30 minutes): a working Claude agent reports at least
  once a minute, so an interrupted turn followed by a prompt days later is not days of work. Fixtures now use realistic
  heartbeats. Tested (removing the cap fails it, measured). A stale comment and a test title fixed.
- Stated: "once per summary" is permanent until a new summary: an agent that ignores the line, or whose delivery was
  unconfirmed, is not told again for that summary (as the #5959 model). A held or screen-blocked agent is looked at
  again every sweep (no try spent).

## Review 5 (opus), and what changed
- Fixed: a new session (a `started` row) starts the count again, so the session told about the work is the one that
  did it (a restarted session may not remember earlier work, and would be asked to summarise it).
- The cap comment says "at most once a minute" (a single long tool call sends nothing until it ends, so the cap can
  undercount, the safe side; measured on real streams: one gap over 30 minutes after a working row).
- An agent already told about this summary is skipped before its history is read. A threshold test pins 3.5 hours (not
  told) against 4.5 hours (told). The plan's decision line and the server comment name workedSinceMs.

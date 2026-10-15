# #6209 part 2: a direct prompt when the running summary is overdue

## Finished looks like
An idle Claude agent whose newest summaries/YYYY-MM-DD-HH.md is older than the four-hour rhythm AND that has reported
more than the rhythm of work since it (projectview.workExcused) is told ONCE, typed into its session, instead of the
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
- Only "stale after workExcused" is owed: a stale file alone is a fact, not a fault (an idle agent is not expected to
  write). An agent with no summary file at all is not told (a role without the rhythm never writes one).
- Claude only, idle only: the screen readers that keep a typed line out of an open menu know Claude Code's screens.

## Weakest premise
That workExcused's reading of reported work is right for this purpose: it counts only REPORTED work, so an agent whose
working reports were lost is not told, and one whose reports overstate work is told early.

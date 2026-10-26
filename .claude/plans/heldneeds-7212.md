# kosmos#7212 slice 2b: messages held behind an input box need the person, everywhere at once

## Build (one gate everywhere: an agent Kosmos started, idle or working, heldInput.count > 0)
- engine/status.js needsPerson; web/index.html agentNeedsAttention and tskNeedsSig.
- engine/projects.js: the member projection carries heldInput; needsYouReason returns `held_input` after the agent's own
  conditions and before own_bound; NEEDS_REASONS (dismissals) gains it.
- engine/cardlabel.js NEEDS_REASONS (the phone's Today); web/index.html PJ_NEEDS_WHY and pjAlsoWhy.
- server.js: safeRoster and /api/status rows carry heldInput for agents Kosmos started.
- ios/Kosmos: Board.needsPerson and the three reason tables (TodayLogic, BoardRoom, TasksLogic), with LogicTests.
- engine/heldinput.js sweep: the phone is told once per stretch, the first minute it counts, saved on disk.

## Not in this slice
- A cooldown class of its own for the held push (phonenotify shares needs_you's per-agent 5-minute cooldown).

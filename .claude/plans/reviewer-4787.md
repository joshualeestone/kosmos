# reviewer-4787: #4787 slice 3, a repeating task's named reviewer

Stacked on slice 2 (missedrun-4787, PR #5416): it reads slice 2's missedRuns. Rebased onto main once #5416 merges.

Built:
- tasks.setReviewer: a repeating task names ONE reviewer of its results: the person ('me', set only from the screen), an agent on the project (checked inside the same write), or nobody. A reviewer the person chose is theirs: a process cannot change it. Each change is in the task's history. Stopping the repeat takes the reviewer and the told mark with it.
- engine/missedtell.js: owed() lists each open, repeating, reviewed task whose latest missed slot (slice 2) is newer than the slot last told (missToldAt) and not before the reviewer was named; nothing in a paused project or on a held task (#4771). sweep():
  - an AGENT reviewer gets one line through the board's typing path (chat.deliverAutomatic): the task, the run missed, who runs it. Only into a pane that is ours and not a switched-off swarm, only with live execution allowed and the brake off (the nudge's gate), counted in the board-wide hour shared with the nudge (Agent Communication's limit). A line that reaches nothing is tried up to 3 times, then recorded as not reached.
  - the PERSON as reviewer is told by the task: while a run is missed the Tasks route marks it waitingOnPerson, so it is in Needs Your Decision (that group's why says so), and the history records the miss.
  - either way the task's history gets one "missed" entry per slot, with who was told.
- server.js runs the sweep on its own minute timer (not the Prompter tick, which types only through prompterTick, pinned by engine/agentnudge.test.js).
- The repeat route takes `reviewer` (with or without a rule; omitted, unchanged). `kosmos task repeat <p> <n> --reviewer <agent|none>` on the Mac and Windows CLIs. The task page has an "If missed, tell" choice (Nobody, Me, the project's agents) under Repeats, saved on change, shown only for a task that repeats.

Decided:
- One reviewer, not a list: a list has nobody accountable.
- The person is told through Needs Your Decision, not a phone push: a push needs a new coordinator kind (#718), a relay change. Follow-up if this is too quiet.
- The owner is not told again: slice 1's nudge already asks the owner.
- An agent cannot name the person as reviewer: asking the person to be told is the person's call.
- A person-reviewed task with no owner is not in Needs Your Decision (taskState needs a holder for 'decision'); its row's red line still shows. Left as is.
- The agents' instruction block does not mention --reviewer: it is the person's choice in the usual case, and the block is a measured text (claude -p). The CLI help names it.

Weakest premise: that a missed run is worth interrupting someone for. If agents under-report runs (slice 2's premise), the reviewer is told about healthy jobs. The once-per-slot rule bounds it to one line per missed slot, never one per minute.

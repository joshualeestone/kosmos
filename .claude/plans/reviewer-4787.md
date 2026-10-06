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

Review 1 (fixed): a quota-held or busy delivery spends no try (as the nudge and the reply nudge); a line placed in this process is never typed again even when its told mark cannot be saved (the book keeps 'told', pruned after a week); a reviewer taken off the project is held, not typed into (#5034's boundary); a held task or a paused project is never put on the person; a reviewer sent with a rule is checked before the rule is stored (tasks.reviewerProblem), so nothing is half-applied; the person's choice is theirs including Nobody, and choosing what an agent named makes it theirs; the history names the missed slot; focus returns to the choice after a save, and the task the person moved to is repainted; the CLI line names the reviewer beside the rule.

Review 2 (fixed): a process cannot stop a task whose reviewer the person chose (stopping it cleared the person's choice, and the process could then name its own after setting the rule again); a rule and reviewer for a task that does not exist answers 404 as the rule alone does; --at and --on with no frequency are refused, never dropped. Left: an archived project's person-reviewed miss is not excluded from the Tasks route's waitingOnPerson (the Tasks view leaves archived projects out, except a project door's own).

Review 3 (fixed): closing a repeating task drops its reviewer with its rule (dropReviewer, every place the rule is dropped), so a reopened task never brings back an old reviewer still marked as the person's; the route refuses a time or day sent with no frequency, as both CLIs do.

Review 4 (fixed): "runs it" means holds an OPEN part (as the nudge's openParts), so an agent whose part is done is told as reviewer; "nobody" means no reviewer, as task assign reads it; a process stopping a task whose reviewer the person chose gets 403. Left: --reviewer takes the agent's session name only, not the spelling variants task assign accepts.

Review 5 (fixed): the task history says the reviewer and a missed run in words (tkActPhrase), never the raw kind; Kosmos's own "missed" note is not activity, so a dead job does not sort as fresh; a reviewer who also runs the task IS told (round 3 had skipped it, trusting slice 1's nudge, which needs the Prompter on and the agent idle), in its own words ("You run it and review its results").

Review 6 (fixed): a finished task hides the reviewer row (tkPaintRepeat's early return paints it); a process cannot close a task, or its last part, when the person chose its reviewer (closing drops the choice with the rule), as it already could not when the person set the rule; a capped count is recorded as more ("More than 99 runs missed"); the roster is read only when an agent can be typed into.

Review 7 (fixed, nits only): the reviewer row's "Saved." line clears when the row hides; the roster is not read for a reviewer taken off the project.

Decided:
- One reviewer, not a list: a list has nobody accountable.
- The person is told through Needs Your Decision, not a phone push: a push needs a new coordinator kind (#718), a relay change. Follow-up if this is too quiet.
- The owner is not told by this unless it is also the reviewer (slice 1's nudge asks the owner about open work; a reviewer asked to be told about misses).
- An agent cannot name the person as reviewer: asking the person to be told is the person's call.
- A person-reviewed task with no owner is not in Needs Your Decision (taskState needs a holder for 'decision'); its row's red line still shows. Left as is.
- The agents' instruction block does not mention --reviewer: it is the person's choice in the usual case, and the block is a measured text (claude -p). The CLI help names it.

Weakest premise: that a missed run is worth interrupting someone for. If agents under-report runs (slice 2's premise), the reviewer is told about healthy jobs. The once-per-slot rule bounds it to one line per missed slot, never one per minute.

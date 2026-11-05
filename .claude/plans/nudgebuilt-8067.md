# nudgebuilt-8067: the idle-work nudge says when a task is already marked built (kosmos#8067)

## Measured, real engine in a sandbox
A task an agent marked built, a closed task, and a task a person marked built draw no nudge, before or after a restart. A task a colleague marked built, or an unnamed caller marked, draws one nudge per stall, and again after each restart.

## The call
Change the line, not the rule. The mark is on the task and the work is per part (`assigner.hasOpenWork`, deliberate, held to agreement by a test), so the agent's part really is open. Suppressing the nudge would leave real work silently unnudged. The line now says the task is marked, by whom, and names the command that covers the agent's own part, asking for a note of its own. A mark with no name says so and promises nothing, since from a pane Kosmos cannot name the command would not end it.

Known, and left: when the agent marks it, its note replaces the colleague's on the task row, as any later mark always has. The colleague's note stays in the task's history. Rejected carrying the note over: nothing records who wrote it, so it would be shown and sent under the wrong name.

Rejected: a mark freeing everyone on a task. That would free an agent with unfinished work because a colleague finished theirs.

Also: `setBuilt` refuses an agent's note that is only a placeholder such as `<what you finished>`. The line now puts one in front of every such agent, and quoted, the shell passes it.

## Weakest premise
That this is what the reporters hit. Their own task was not reachable. The real board here holds no such task, which neither confirms nor refutes it. If the reports continue after this ships, the cause is elsewhere.

## Not done
An end-to-end run on a real board with a live idle agent: no harness exists, and it needs two heartbeats of at least 15 minutes. The mark route's naming was read from source, not driven.

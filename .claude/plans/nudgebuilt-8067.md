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

## Measured on a real board
A real server.js with its real heartbeat at 5 minutes, in a sealed sandbox, run for 6 minutes, restarted so its memory was gone, and run again. Open: nudged in both runs. Colleague's mark: both. Unnamed mark: both. Own mark, closed, and an agent holding nothing: neither run.

## Not done
The board's decision was measured, not a delivered message: tmux is the repo's fixture and DRY_RUN is on, so delivery reads could_not there. The wording is pinned by the engine tests. The mark route's naming was read from source, not driven.

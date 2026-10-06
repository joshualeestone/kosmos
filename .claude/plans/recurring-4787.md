# recurring-4787: recurring work as a first-class task (slice 1)

**Card:** kosmos#4787 (ten feedback reports; Splinter 05:33 assigned it; plan on the card).

**Finished looks like:** a recurring job is an ordinary open task that repeats, owned by the agent that runs it, so the board shows who runs it, how often, when it last ran and when it runs next, instead of the job looking ownerless; and the Prompter and Assigner do not call that agent idle-with-work between runs.

**Change:**
- engine/taskrepeat.js (pure): the rule (every hour at :MM, every day at HH:MM, every week on a day at HH:MM, local time), DST-safe `nextAfter`, `describe`, `whenWords`, `waitingForNextRun` (from the later of the last run plus a small grace and when the rule was set; a future-stamped run is due).
- engine/tasks.js: `setRepeat` (the person owns a rule they set; never over the person's built mark; drops a built mark; clearing clears runs; stamps repeatSetAt) and `recordRun` (the person is a flag; per-runner 60 s duplicate guard). Closing (task or last part) ends the rule; a repeating task is never built.
- server.js: POST .../task/<n>/repeat and /ran (screen, token or pane; non-members and unidentified callers refused); a process cannot close the task or its last part when the person set the rule; GET /api/tasks rows carry repeatWords / repeatNextAt / repeatNextWords.
- agentnudge.openParts and assigner.hasOpenWork skip a repeating task between runs.
- CLI: `kosmos task repeat` / `kosmos task ran` (--note) and a "[repeats ...]" list marker, Mac and Windows.
- web/index.html: the Tasks row's repeat line and the history phrases.

**Rejected:** a Kosmos scheduler that starts jobs (competes with the person's own; they asked to see the job and be told when it fails); a separate Recurring list (the complaint is that recurring work lives outside the task list).

**Next:** slice 1b, the agents' instruction line (measured with claude -p as the block requires) and the task page's line and a screen control; slice 2, the missed-run alert (plan on the card).

**Weakest premise:** that agents will record each run. Until slice 1b ships the instruction line, the verbs are found through `kosmos task --help`.

# greettasks-9239 (kosmos#9239)

**Problem.** From two feedback reports on 2026-11-27:
- A restarted agent checked its own notes before thinking of its open tasks.
- Several separate nudges a day feel like being pinged; one rolled-up "what is waiting on me" was asked for.

**Change.** GET /api/away adds one line, "waiting on this agent now", from engine/awaydigest.js openWorkText. It shows at a startup (the hook) and by hand (`kosmos away`, text and JSON). It names:
- the open tasks the agent holds, as task numbers by project, with `kosmos task list --mine`;
- how many of the person's direct messages it has not answered, with `kosmos inbox --unanswered`.

The counts use the commands' own rules, now shared helpers in server.js: `myOpenTasks` (from GET /api/tasks/mine) and `unansweredOf` (from GET /api/inbox).

**Rules kept:**
- Only numbers and plain-token project ids, never a title or a message's words (the digest's rule).
- The open tasks only when the caller's own agent token names it.
- A failed read leaves that part out and changes nothing else.

**Rejected:**
- A new verb: `kosmos away` is already the "while you were away" view.
- Titles or words in the greeting.
- Merging the existing nudges: each has its own schedule and owner, so that is a follow-up, noted on the card.

**Weakest premise.** That an agent acts on a line in its startup context.

**Measured cost.** On this Mac's real board (9 projects, 28 tasks), projects.readAll plus tasks.allTasks took 21 ms, against the startup hook's 1 s budget.

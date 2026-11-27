# kosmos#9217 slice 1: a heavy job announces itself, and the board shows it

Card: kosmos#9217. Reviewed by Splinter 2026-11-27 (go, in slices). Builder: Renet Tilley.

## Problem

Several agents on one computer each start a long, heavy run (a full suite, a validation). Two at once contend, and
nothing in Kosmos shows that another agent is already running one, so the collision is found afterwards. The fix has
to be in the product, not in this fleet's queue scripts: ordinary users do not have `tools/queued-heavy.sh`.

## Approach (slice 1, passive)

- `engine/heavyjobs.js`: `start`, `end`, `live`. Records in `<data root>/heavy-jobs.json`, written under a file lock.
  A record names an agent, a label, a time, and optionally one exact process (pid plus its start time, read by the
  server through restoresink's `processStart`, so a reused pid is not mistaken for the job).
  Every read drops a record whose process is gone or reused, whose agent is gone, or that is older than 12 hours (a
  ceiling against a stuck record). A process is first asked by signal 0 (no process spawned, works on Windows); only a
  live one has its start time read, and that read is kept 10 s. One agent holds at most 4 live records (a start drops its dead ones). A write that fails
  is said in Kosmos words, never thrown. A label is stored with brackets as parentheses (another agent reads it in
  `kosmos heavy`, and every Kosmos marker starts with `[`) and refused with direction marks. One read runs ps for at
  most 8 records; the rest are judged by signal 0 and the cache, so a reused number there goes unseen until a later
  read. A new record's start is read fresh, never from the cache.
- `server.js`: `POST /api/heavy {action: start|end, label, pid}` and `GET /api/heavy`, agent-token routes. The caller
  is named the way `/api/agent/reply-channel` names it (processCaller: a token exactly, else a pane given in the body,
  as given, so a local process that can name an agent's pane can record or end a job as it); a page is refused. `GET` refuses a cross-site or
  sibling read. `/api/status` gains `heavyJobs`, each with the agent's display name.
  An agent missing from the running rows is judged gone only after 90 s of complete reads, so one poll caught mid-restart
  keeps its record; a partial snapshot starts no clock, and a successful `start` clears the agent's mark.
- `install/kosmos` and `tools/windows/kosmos-cli.js`: `kosmos heavy` (list), `kosmos heavy start "<label>" [--pid N]`,
  `kosmos heavy end [--pid N]`, in both CLIs (tools.windows-kosmos-cli-verbs-parity.test.js requires it).
- `web/index.html`: a `#heavy-slot` in the top notes, hidden when empty, painted by `paintHeavyJobs` from the status
  poll: "A heavy job is running on this computer: <label> (<agent>, since HH:MM)." Built from text nodes.

## Decisions

- **Default is no pid: the record is tied to the agent.** The design comment said the default would be the calling
  shell. Measured reason to change it: an agent's tool call runs in a shell that exits as soon as the command returns,
  so a record tied to `$PPID` would clear itself at once. `--pid` is for a wrapper that outlives the call (the
  follow-up makes `queued-heavy.sh` pass its own `$$`). Rejected: walking up to the agent's long-lived process, which
  is runner-specific and is the pane-scraping this codebase is moving away from.
- **A process whose start time cannot be read is KEPT while signal 0 says it exists.** This is a passive notice:
  showing a finished job a little too long is a smaller harm than hiding a running one. On Windows (no ps) that means a
  reused process number is not told apart from the job.
- **The Windows CLI is in this slice.** The design comment said it would go to Homer; the parity test and Splinter's
  #4373 scope (a verb added to both CLIs is done Mac-side) say otherwise. Homer is asked for one real run on Windows.
- Not in this slice: the `queued-heavy.sh` call (a follow-up PR), and turns or reservations (slice 2).

## Tests

engine/heavyjobs-9217.test.js (also run on Windows, tools/windows-tests.js ALSO), server.heavy-9217.test.js,
cli.heavy-9217.test.js and its Windows twin tools.windows-kosmos-cli-heavy-9217.test.js, web.heavy-9217.test.js, and
docs/browser-checks/render-heavy-9217.js (a real board, with a nothing-running control). Each new page arm was
mutated to red.

## Weakest premise

That agents call `start` and `end` reliably (Splinter's). The self-clearing limits a missing `end`; a missing `start`
is simply invisible. If feedback shows agents do not call it, a later slice can detect heavy processes instead.

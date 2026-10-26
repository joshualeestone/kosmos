# restoreworld-5536: the Restored world, and restored agents listed (kosmos#5536 slice 4b)

Design: #5536 comment 6407859949. Enable path measured on comment 6408905798 (create.installJob works on a folder with
no profile record, and STARTS the agent: enable then bootstrap).

## The call
- `engine/restoreworld.js`, three calls, nothing wired (the restore screen is slice 4c):
  - `prepareRestoreWorld(base, { member, now })`: `worlds.createWorld(base, "Restored: <member>, <YYYY-MM-DD>")`, with
    " (2)" to " (9)" when the id is taken (hidden worlds included, read from the registry), then a new, empty folder
    `restored` (0700) inside the world folder for engine/restoresink.js. If that folder cannot be made the world is
    hidden again and the call says so.
  - `finishRestoreWorld({ base, world, restoreDir, result })`: only after a restore that succeeded (runRestore's
    `result.ok === true`, refused otherwise) and after its sink is closed. Refuses while the restore folder holds any of the sink's own entries (its record after a stop, its lock
    while open, its temp folder after a crash): that restore continues where it is (slice 3). Moves `restored/workers` and `restored/projects` into the world's own folders (as `worlds.envOverridesFor`
    names them) by rmdir of the empty target plus rename. Every check runs before anything moves. Only the folder
    prepareRestoreWorld made is accepted. Returns what stayed (agents and projects kept elsewhere, transcripts), never
    the sink's record or lock.
  - `listRestoredAgents({ base, world, restoreDir })`: each folder in the world's workers and in `restored/agents`,
    with a `because` when it cannot be enabled (a link, which is not opened; a folder name create.js cannot start; no
    instructions file; kept outside the workers folder), and `runs`: the files that run or load something when the
    agent starts (Claude settings and hooks, .mcp.json, .envrc, Codex and Gemini settings, `@` imports in the brief),
    for the screen to show before any enable. Registers, starts and writes nothing.
- The member's name loses control, format and bidi characters and is cut at 60 code points before it names a world.

## Rejected
- `engine/worldimport.js` for the agents: it needs a store profile (a snapshot has none) and records a start.
- Restoring straight into the world folder: createWorld pre-makes store, projects and workers, and the sink needs an
  empty root.
- Registering restored agents here: installJob starts them, and design 6 says each agent needs its own enable.

## Review rounds (blind, security-focused)
1. B: finish moved a stopped restore (no record or lock check), and a test pinned it. W: start-time files not
   flagged; no Windows rename retry; a create race failed instead of trying the next name; the default name rule
   untested. Nits taken: sink entries by prefix, combining marks capped, a junction on Windows, absolute base in all
   three calls. Deferred: a member named only in non-Latin script gets an id of "restored<date>", so two such members
   share the nine names a day (the shown name keeps their script; rare, and refusal is said plainly).

2. W: imports were seen only at a line start and in the first brief; a brief over 512 KB went unflagged; only parts
   of .claude were listed; folder and kept names were returned raw for the screen; finish trusted the caller that the
   restore succeeded; the sink prefix was compared case-sensitively. Nits taken: the error code in a failed move, the
   put-back failure said, blank-only names fall back. Deferred again: the shared nine-name pool (round 1), and a
   create failure after its registry row was written being read as a clash (the row means the world exists).

3. B: a .git in an agent folder (core.fsmonitor runs when git runs there, which a provider does at start) went
   unflagged: such an agent is now not offered, and a .git at the top of workers blocks every agent. W: entries at the
   top of workers and projects, and project folders with start-time files, are now returned as `shared`; a world
   folder left on disk under the chosen id is hidden and the next name taken. Nits taken: a brief is read only if the
   opened file is the one lstat saw; a linked brief is named. Deferred: Atomics.wait pauses up to about 2.8 s on
   Windows (the sink does the same); a member name can carry a date that reads like the world's, and two folders can
   share a label (4c tells rows apart by `folder` and shows the world's creation time).

## Residuals, stated
- A restore that stops is never finished: it stays in `restored` and continues there (slice 3). Nothing here cleans it.
- A rename failing part way leaves workers moved and projects not; `moved` says which. Re-running finish moves the
  rest, since the moved root is gone from `restored`.
- Agents kept outside the workers folder (`restored/agents/<id>`) are listed and cannot be enabled where they are.
- Enabling (4c) must run installJob under THIS world's roots (installJob uses the active world's workers folder).

## Weakest premise
That an agent with a job and no profile row shows on the board like any other once enabled. installJob writes no
profile; the board may learn of it another way (discover/connect). 4c must check this before offering enable.

# restoreworld-5536: the Restored world, and restored agents listed (kosmos#5536 slice 4b)

Design: #5536 comment 6407859949. Enable path measured on comment 6408905798 (create.installJob works on a folder with
no profile record, and STARTS the agent: enable then bootstrap).

## The call
- `engine/restoreworld.js`, three calls, nothing wired (the restore screen is slice 4c):
  - `prepareRestoreWorld(base, { member, now })`: `worlds.createWorld(base, "Restored: <member>, <YYYY-MM-DD>")`, with
    " (2)" to " (9)" when the id is taken (hidden worlds included, read from the registry), then a new, empty folder
    `restored` (0700) inside the world folder for engine/restoresink.js. If that folder cannot be made the world is
    hidden again and the call says so.
  - `finishRestoreWorld({ base, world, restoreDir })`: only after a restore that succeeded and after its sink is
    closed. Moves `restored/workers` and `restored/projects` into the world's own folders (as `worlds.envOverridesFor`
    names them) by rmdir of the empty target plus rename. Every check runs before anything moves. Only the folder
    prepareRestoreWorld made is accepted. Returns what stayed (agents and projects kept elsewhere, transcripts), never
    the sink's record or lock.
  - `listRestoredAgents({ base, world, restoreDir })`: each folder in the world's workers and in `restored/agents`,
    with a `because` when it cannot be enabled (a link, which is not opened; a folder name create.js cannot start; no
    instructions file; kept outside the workers folder). Registers, starts and writes nothing.
- The member's name loses control, format and bidi characters and is cut at 60 code points before it names a world.

## Rejected
- `engine/worldimport.js` for the agents: it needs a store profile (a snapshot has none) and records a start.
- Restoring straight into the world folder: createWorld pre-makes store, projects and workers, and the sink needs an
  empty root.
- Registering restored agents here: installJob starts them, and design 6 says each agent needs its own enable.

## Residuals, stated
- A restore that stops is never finished: it stays in `restored` and continues there (slice 3). Nothing here cleans it.
- A rename failing part way leaves workers moved and projects not; `moved` says which. Re-running finish moves the
  rest, since the moved root is gone from `restored`.
- Agents kept outside the workers folder (`restored/agents/<id>`) are listed and cannot be enabled where they are.
- Enabling (4c) must run installJob under THIS world's roots (installJob uses the active world's workers folder).

## Weakest premise
That an agent with a job and no profile row shows on the board like any other once enabled. installJob writes no
profile; the board may learn of it another way (discover/connect). 4c must check this before offering enable.

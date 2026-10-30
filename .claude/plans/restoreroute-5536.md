# restoreroute-5536: the restore listing off the event loop (kosmos#5536 slice 4c-2, part 2a)

Stacked on restoregitcfg-5536 (part 1); rebased onto main when part 1 merges.

## Why this first, and not the route
Measured in the board code: no route calls any restore module; runRestore's member key/release (#5686 b2), device-key
history (#7116, needs-device) and the board's read-grant client do not exist yet. A review route could list only worlds
nothing can make. Every caller (route, CLI, admin screen) needs the listing off the event loop, so that comes first.
Design call: #5536 comment 6513912365.

## Change
- engine/restoreworld-child.js: `list <base> <world id> [<restore folder>]`, one JSON line, exits 0, its own exit
  timer. The world is looked up in the registry by id, never taken from the caller.
- restoreworld.listRestoredAgentsInChild({ base, world, restoreDir? }, { execFile? }): starts it with env =
  preWorldEnv(process.env) + envOverridesFor(base, world) + KOSMOS_WORLD, so create.js there takes the Restored
  world's store root, derived from the same base the listing reads. Timeout 60 s, stdout cap 32 MB.
- Any failure (error, timeout, overflow, junk, a listing missing a field) answers no rows, more: true and a because:
  the contract's refusal shape, so it never reads as an empty restore. The default Kosmos is refused without a child.

## Decided
- Child process, not a worker thread: the store root is frozen per process at module load (worlds.js:271), and a
  thread shares it.
- envOverridesFor over applyAgentWorldEnv: the latter derives from the env's own base, which can differ from the base
  the listing is given.

## Measured
- Real child against a finished restore (two agents, a project with core.pager): deepEqual to the in-process listing.
  An unknown world id answers the registry refusal.
- Stubbed execFile: env carries the world's DATA/WORKERS and KOSMOS_WORLD; args are list/base/id; four failure shapes
  refuse; a child's own because is passed through; the default world starts no child.
- Mutations, each red: the child returning an empty listing; failed() without more/because; env without the world's
  roots. Restored.
- restoreworld-5536 + engine.reachable + win32-separator-guard + windows-coupling-audit-1732: 85/85.

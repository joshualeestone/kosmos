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

## Review round 1 (opus): 0 BLOCKER, 2 WARNING, 1 CONVENTION, 4 NIT
- FIXED: the hand-built env lacked the pre-world marker applyWorldEnv records, so anything the child starts would
  derive the world's own folder as its base. worlds.applyWorldEnv is now exported and used, on preWorldEnv of the
  board's env, with the listing's base. Test: a board serving another world; the child gets this world's PROJECTS and
  a marker naming this world with the board's original roots.
- FIXED: the child was untracked. One listing per world at a time (a second ask shares the answer), and stopListings
  ends running children (each answers a refusal). Excused in engine.reachable until a route calls it.
- FOUND BY THE NEW TESTS: the not-JSON path resolved without clearing the in-flight entry, so every later listing of
  that world would have returned the stale refusal. Fixed; every path goes through done(). Also an answer given
  synchronously no longer leaves an entry behind.
- FIXED: the child's timer comment (it bounds the end, not the synchronous listing); a relative base is refused before
  any child; the doc says a consumer refuses on `because`, not `more`; the first test's title says "successful".
- Tests 86/86 with the guards; worlds tests 76/76. Mutations (junk path via resolve; no in-flight check; env without
  the marker) each red; restored.

## Review round 2 (sonnet): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 4 NIT
- FIXED: stopListings killed children but a later ask started a new one, and a same-key ask could get the killed
  answer. It now sets a stopped flag (every later ask is refused, no child) and clears both collections.
- FIXED: no real-child test could fail on a wrong env (the listing takes its folders from base and world). The child
  now reports its store root and the parent refuses any root but worlds.worldStoreRoot(base, world), so the env is
  checked at run time. With the env dropped, the real-child test reds.
- FIXED: rebased onto restoregitcfg-5536's proof commit; the duration figures now say which budget each covers; the
  shared answer is documented as one object.
- Tests 86/86. Mutations (env dropped; root check removed; stopped flag removed) each red; the last first hung, so
  the test now races its ask against 2 s and fails fast. Restored.

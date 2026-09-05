# Plan: #1704 slice 2a -- wire the world registry into the board (startup + list/create API)

Builds on slice 1 (engine/worlds.js, merged PR #2184). Slice 2a is the tractable half
of slice 2: it makes the registry LIVE (the board reads the active world at startup)
and gives the UI its list + create endpoints. The switch flow (2b) is separate.

## What this slice does
1. **Startup wiring** (server.js start()): capture the registry base from the ORIGINAL
   env, then `worlds.applyActiveWorldEnv(process.env, base)` before any root resolves
   (ahead of ensureToken at onListening; roots are per-call, #1443). Fail-open. It is a
   NO-OP for the default world -- and every install is the default world until 2b's
   switch API can make a named world active -- so existing installs are unaffected. The
   captured base lives in `worldRegistryBase` and is used by the routes (a request-time
   baseRoot would resolve to the ACTIVE world's data root, not the world-independent
   registry, once 2b lets a named world be active).
2. **GET /api/worlds**: `{ worlds, activeWorldId }` (listWorlds + activeWorld).
3. **POST /api/worlds** `{name}`: create a world (does NOT switch to it). Returns
   `{ ok, world }` or a 400 with a person-readable reason.

## Deferred slice-1-review items folded in here (now that create is exposed)
- **Registry write lock** (worlds.js `withRegistryLock`): a fail-fast cross-process
  lock (atomic mkdir) around createWorld/setActiveWorld's read-modify-write, so two
  boards on one machine cannot lost-update. NO event-loop spin: the critical section is
  sub-ms, so a live collision throws a retryable "in progress" rather than blocking; a
  stale lock (crashed holder, mtime > 10s) is broken. A within-board race cannot happen
  (the ops are synchronous). Tested: held-lock fail-fast, stale-break, release-no-leak.
- **API error translation** (server.js `worldCreateReason`): store.safeKey throws
  "invalid agent name" for a bad WORLD name; the route translates it to
  "...a name we can use for a Kosmos...".

## Still deferred to slice 2b (the hard part)
- **POST /api/worlds/active** (switch) + the board-restart lifecycle. There is NO
  in-process self-restart route; the board restarts via tools/restart-local-board.sh, so
  a switch = persist the pointer then trigger a clean process restart (launchd/supervisor
  relaunches into the new world's env). Needs care: in-flight requests, the
  agent-supervisor, launchd. setActiveWorld stays reachability-EXCUSED until 2b wires it.
- **Launchd per-world isolation**: AGENT_WORKFORCE_LAUNCH is still not overridden, so a
  named world's agents would collide with the default world's plists by name. 2b territory
  (named worlds cannot run agents until switch exists).
- **Dedup-on-read** (cosmetic): a hand-edited registry with duplicate ids surfaces both
  to the UI. Safe (find/worldBaseDir handle dups); 2b/cosmetic.

## The named-world "does a root resolve before start()" question -- DEFERRED to 2b
applyActiveWorldEnv only changes roots when a NAMED world is active, which cannot happen
until 2b's switch. So in 2a the wiring is always a no-op and the "did any module resolve a
root at module-load, before start()" analysis (the correctness premise for a NON-default
active world) is a 2b concern. The codebase invariant (#1443/#1432: roots are per-call,
NOT at require) is the basis; 2b verifies no module violates it.

## Verification
- engine/worlds.registry-1704.test.js: 17/17 (14 registry + 3 lock).
- server.test.js: 2 sandboxed #1704 route tests (GET/POST, reserved + translated-error);
  booting the sandboxed server also exercises the start() wiring (default-world no-op).
- reachable gate: create/list/apply now have real callers; only setActiveWorld stays
  excused (2b).
- No web/ change, so no browser-check gate. (server.js is a rendered-surface-adjacent
  file but not web/; the #1720 gate keys on web/.)

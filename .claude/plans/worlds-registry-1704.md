# Plan draft: #1704 Multiple Kosmoses switcher BACKEND (engine)

Status: DRAFT (non-colliding prep per Splinter; awaiting Mona-claim confirm before building).
Owner split: Mona Lisa = design + header/dropdown/modal UI (done, gated on this backend);
Angel = engine backend (this).

## Goal
Let one install hold multiple "Kosmos worlds" (each its own projects, agents, settings,
conversations), with create + switch-active + a registry the UI can list. Migration-safe:
**every existing single-Kosmos install MUST keep working untouched** (the release gate).

## What a "world" spans (measured in engine/)
A world is NOT just the store root. The data a world owns is resolved by per-call,
env-var-reading functions scattered across ~8 modules, with NO single resolution point:
- **store root** `dataRootFor` / `AGENT_WORKFORCE_DATA` (store.js:82) -> profiles, avatars, settings
- **projects root** `AGENT_WORKFORCE_PROJECTS` / projectsRoot (projects.js:1368)
- **workers root** `AGENT_WORKFORCE_WORKERS` / workersDir (create.js:206, instructions.js:55)
- **launch agents** `AGENT_WORKFORCE_LAUNCH` (create.js:211)
- **home base** `AGENT_WORKFORCE_HOME` (homeDir() duplicated in accounts/create/openaiaccounts/
  runners/delete-leftover, etc.)
Today there is ZERO per-instance/world concept (grep for worldId/instanceId/activeWorld = none).

## The resolution strategy (the key decision): env-var indirection, not 8 code edits
Because every root already reads an `AGENT_WORKFORCE_*` env var per call, the migration-safe
seam is to SET those env vars for the active world at board startup, BEFORE any module resolves
a root. Existing modules need NO changes.
- **Default world = the LEGACY roots, in place.** When the active world is the default (the only
  state an existing install can be in), set NO overrides -> `dataRootFor`/projectsRoot/workersDir
  resolve exactly as today. **No data is moved. Existing installs are byte-for-byte unchanged.**
- **A named world = a base dir** (e.g. `<worldsBase>/<worldId>/`) with `data/`, `projects/`,
  `workers/` under it; startup sets AGENT_WORKFORCE_DATA/PROJECTS/WORKERS to those paths.
- Rejected alt: threading a worldId through all ~8 root functions (large blast radius, easy to
  miss a module -> a leak of one world's data into another; the env seam already exists and is
  the single choke point).

## Registry (world-independent, lives ABOVE any world)
`worlds.json` at a fixed, world-independent location (the legacy store root, so an existing
install's registry sits beside its current data): `{ version, activeWorldId, worlds: [{ id, name,
createdAt, base }] }`. **Absent registry => exactly one implicit default world, active.** That is
the migration state: an untouched install has no worlds.json and behaves as the single default
world. First write of worlds.json (on the first "create world") seeds the default entry too.

## Operations
- **list**: read worlds.json (or synthesize the single default when absent).
- **create(name)**: allocate a worldId (safeKey), mkdir its base + data/projects/workers,
  append to worlds.json. Do NOT switch to it implicitly (surprise). Return the new world.
- **switch-active(id)**: validate id exists, set activeWorldId, persist. Then the board must
  re-resolve roots for the new world. Roots are per-call, so new reads pick up the new env; BUT
  in-memory caches/state (open conversations, watchers, agent processes) belong to the old world.
  ==> **switch-active requires a board restart (or a full state teardown+reinit).** Simplest safe
  v1: persist the new activeWorldId, then trigger the board's existing restart path so it boots
  into the new world's env. (Confirm with the restart-local-board / board lifecycle seam.)

## Migration safety (the release gate) -- how each is guaranteed
- No worlds.json => single default world => zero behavior change. (Existing installs.)
- Default world sets NO env overrides => legacy roots resolve in place => no data move, no
  path change, no re-index. (The dangerous operation -- moving an existing user's data -- is
  never performed.)
- worldId is safeKey-sanitized (reuse store.js:safeKey) so a name can never escape its base
  (../ traversal into another world or outside the store).

## Open questions to resolve before/while building
1. **Switch = restart?** Confirm the board lifecycle: is there a clean reinit, or is a process
   restart the only safe way to flip the active world? (Likely restart for v1.)
2. Where exactly does the board read the active world at startup, to set the env before the first
   root resolution? (server.js boot path -- find the earliest point.)
3. Does anything ELSE hold a root that is NOT an AGENT_WORKFORCE_* env seam (a hardcoded path)?
   If so, the env-indirection strategy has a hole there -- audit for any raw homedir()/hardcoded
   Application Support path that bypasses the env vars.
4. UI contract with Mona: what does list/create/switch return (shape), and does switch respond
   before or after the restart?

## Verification plan
- Unit: worlds.js registry (list/create/switch) with a sandboxed worlds.json; default-when-absent;
  safeKey traversal control; activeWorldId persistence.
- Migration test: an install with data but no worlds.json resolves to the default world with the
  legacy roots UNCHANGED (assert the resolved paths equal the pre-feature paths). This is the
  release-gate test made executable.
- No web/ change in the backend slice (UI is Mona's), so no browser-check gate.

## Slice boundaries (incremental, like #2037/#2125)
- **Slice 1 (THIS PR): the registry module `engine/worlds.js` + unit tests.** The
  migration-safe core: readRegistry (default-when-absent, fail-safe), listWorlds,
  activeWorld, createWorld, setActiveWorld, envOverridesFor, applyActiveWorldEnv.
  The RELEASE GATE lives here and is executable: no registry => default world =>
  NO env overrides => legacy roots byte-for-byte unchanged. 14 tests pass,
  including the migration gate + a traversal control. Pure data layer, no server.js
  change, no web/ change (so no browser-check gate).
- **Slice 2 (next, mine): wiring + API + switch lifecycle.** Call
  applyActiveWorldEnv at the top of server.js start() (a no-op for existing installs,
  so zero behavior change); add GET/POST /api/worlds (list/create) + POST
  /api/worlds/active (switch); switch persists the pointer then triggers the board
  restart so the new world's env takes effect and its agents (launchd) relaunch.
  Touches the sensitive boot path + routes, so it gets its own focused review.
- **Slice 3 (Mona Lisa): UI** -- persistent header + instance-name dropdown, the
  create-new-Kosmos modal + jump-to-empty, avatar-simplified rows. Built against
  slice 2's API contract.

## Built in slice 1 (done)
`engine/worlds.js` + `engine/worlds.registry-1704.test.js` (14/14). safeKey reused
from store.js (traversal-safe ids); atomic registry writes; AGENT_WORKFORCE_LAUNCH
deliberately NOT overridden (shared launchd resource, a slice-2 switch-lifecycle
concern).

## Slice-2 requirements surfaced by the slice-1 blind review (MUST address before the API exposes create/switch)
1. **Serialize registry writes.** createWorld/setActiveWorld are read-modify-write over worlds.json with no lock; two boards on one machine can lost-update (last rename wins, the other's entry silently dropped, its dir orphaned). Slice 1 is unwired so it cannot bite yet, but slice 2's API MUST serialize (a lockfile, or read-verify-after-rename) before create/switch is reachable.
2. **Launchd isolation for named-world agents.** AGENT_WORKFORCE_LAUNCH is NOT overridden in slice 1 (a sound boundary while nothing runs a named world). The moment slice 2 lets a named world go active AND run agents, their launchd plists land in the shared LaunchAgents dir (create.js:211 agentsDir()) and collide by agent name with the default world's. workersDir IS isolated, so the worker root is right but the service name is shared. Slice 2 must scope the launchd label/dir per world (or block named-world agent launch until it does).
3. **Translate store.safeKey's error at the API.** safeKey throws "invalid agent name" for a bad WORLD name; slice 2's API layer should translate the message before it reaches a user creating a world.

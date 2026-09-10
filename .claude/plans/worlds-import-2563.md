# Add-agents-from-an-existing-Kosmos: the ENGINE slice (kosmos#2563)

## Context

Josh wants, on the create-a-new-Kosmos page, an opt-in "add my agents from" selector so a new
Kosmos can be created carrying agents from an existing one. Angel owns the WEB slice (the selector,
reusing the project agent-selector pattern) and posted the engine contract as the spec. This branch
builds the ENGINE half to that contract. A "Kosmos" is internally a "world" (engine/worlds.js).

## The contract (Angel's, verbatim intent)

1. `GET /api/worlds/list` -> `200 { worlds: [{ id, name, agentCount }] }` (the user's Kosmoses + a
   per-world agent count, to populate the selector).
2. `POST /api/worlds` accepts an added body field `importAgentsFrom: [worldId, ...]` -> COPY the
   agents from each source world into the new world's data root. Source worlds UNCHANGED
   (copy-not-move, Angel's ruled default). `createWorld` ignores extra fields today, so wiring this
   is additive and backward-compatible.

## What a "world" and an "agent" are on disk (verified empirically, not inferred)

- `base = worldBase()` is the registry store root (where `worlds.json` lives).
- A named world's store root is `path.join(worldBaseDir(base, w), store.APP)` where `store.APP` is
  `Kosmos`. The DEFAULT world's store root is `base` itself (legacy roots, base:null).
  Confirmed by probe: `store.dataRootFor` under a named world's env override equals
  `worldBaseDir/store.APP`, and `store.writeProfile` lands a `<name>.json` in that world's
  `profiles/` dir.
- An agent's persistent identity is its store profile `<storeRoot>/profiles/<safeKey(name)>.json`
  (role, reportsTo, provider). Copying the profile is what makes an agent APPEAR on a world's board
  (per the card's own scoping). Agents also have avatars (same store root) and worker instructions
  (`workers/<name>/CLAUDE.md`, a separate root) and a launchd job (the run mechanism).

## Scope (LOCKED)

**IN:**
- `GET /api/worlds/list`: list worlds with a profile-count each.
- `POST /api/worlds` + `importAgentsFrom`: after `createWorld`, copy the source worlds' profile
  JSONs into the new world's `profiles/` dir. Sources untouched (copy, never move). Each copy
  re-mints identity: the source `id`/`idInstall` are stripped so the imported agent gets a fresh id
  on its first `store.writeProfile` (the decided restore convention, store.js:404). Response gains an
  `imported` object `{ copied, skipped, unknownSources }` so the web slice can confirm.
- Collision (the same profile filename from two sources, or already present in the target):
  FIRST-WINS (skip), deterministic, documented. Rationale: never silently overwrite an
  already-copied agent; the source order is the tiebreak.
- Unknown / malformed source world id: skipped (not fatal), surfaced in the response's `imported`
  accounting. A CLEAN_ID / registry-membership check keeps a hand-passed id from traversing.
- `importAgentsFrom` absent or empty: a plain `createWorld` (byte-for-byte the old behavior).

**OUT (documented fast-follows, NOT silently dropped):**
- Copying AVATARS and WORKER INSTRUCTIONS (`workers/<name>/CLAUDE.md`). These live in additional
  roots (avatars in the store root; workers under a separate env-resolved root that differs between
  the default and named worlds), so they are a clean follow-up. The profile alone gives the roster +
  board appearance + role/reportsTo, which is this slice's job (Josh: "so we know which ones to
  carry over").
- Making imported agents RUN. Named-world agents do not run in v1 (worlds.js:21-26: the launch
  layer `AGENT_WORKFORCE_LAUNCH` is deliberately not world-scoped; that is the deferred slice, same
  area as #2238 / the #2528 P0). An imported agent appears with its config and runs once that lands.
  This slice does not and cannot change that, and does not pretend to.

## Design

`engine/worlds.js` gains three read/copy helpers (cohesive with `worldBaseDir`):
- `worldStoreRoot(base, world)`: named -> `path.join(worldBaseDir(base, world), store.APP)`;
  default -> `base`.
- `worldProfilesDir(base, world)`: `path.join(worldStoreRoot(base, world), 'profiles')`.
- `agentCount(base, world)`: count of `*.json` (excluding `*.tmp`) in the world's profiles dir;
  `0` on a missing/unreadable dir (read-only, never throws).
- `importAgents(base, targetWorld, sourceWorldIds)`: for each valid source world (validated against
  the registry), copy each profile JSON that is not already present in the target (first-wins) into
  the target's profiles dir, via a temp-file+rename so a concurrent reader never sees a partial.
  Returns `{ copied, skipped, unknownSources }`. Never touches a source file.

`server.js`:
- New `GET /api/worlds/list` route -> `{ worlds: listWorlds(base).map(w => ({ id, name,
  agentCount: worlds.agentCount(base, w) })) }`.
- `POST /api/worlds`: after `createWorld`, if `body.importAgentsFrom` is a non-empty array, call
  `worlds.importAgents(base, world, ids)` and include the counts in the response. A copy failure is
  non-fatal to the create (the world exists; report what imported), because a half-import must not
  orphan a created world.

## Tests (engine + route)

`engine.worlds-import-2563.test.js`:
- agentCount: 0 on an empty world; N after N profiles; a named world and the default world.
- import copies profiles into the target; each source file still exists (copy-not-move); target
  count == union.
- collision: the same name in two sources copies ONCE (first-wins); a name already in the target is
  skipped.
- unknown / traversing source id is skipped, not fatal; `unknownSources` reflects it.
- empty / absent `importAgentsFrom` -> world created, nothing copied (backward compatible).
Each arm carries a red-capable control (e.g. assert the source is unchanged by reading its bytes
before and after; assert a skipped collision did NOT overwrite the target's version).

## Weakest premise

That copying the profile JSON alone is a faithful-enough "import the agent" for this slice. It is
for the ROSTER + board-appearance purpose Josh named, but an imported agent has no brief until the
worker-instructions fast-follow lands, and cannot run until named-world launch lands. Both are
documented above rather than hidden, and neither is regressed by this change.

# Plan: refuse agent spawn in a named world (#2827)

Branch: named-world-token-2827. Addresses kosmos#2827.

## Bug

A named (non-default) world lets agents be created, but their board token is refused,
so their reports and replies fail. engine/worlds.js scopes named-world agents OUT of
v1 (it overrides AGENT_WORKFORCE_DATA/WORKERS/PROJECTS for a named world but NOT
LAUNCH), yet nothing enforced that, so the broken state was reachable.

## Fix (direction 1: enforce the v1 rule)

Refuse to spawn an agent when the board is booted into a named world. A single shared
guard at the server layer covers both spawn routes:
- `POST /api/agents` (create.createAgent)
- `POST /api/team` (team.createTeam)

Guard: `namedWorldSpawnRefusal()` reads `worldenv.bootedWorld()`.
- null (a never-bootstrapped unit board) -> allow (do not break tests).
- `worlds.DEFAULT_ID` -> allow.
- a named id -> return a refusal {code: 409, error: <clear message pointing back to
  the default world Kosmos 1>}.

Each route calls it right after body parse and, on a refusal, `sendJson(res, code,
{error})` and returns before any creation. create.js stays world-agnostic (it uses
the env the world system set); the world context lives at the server layer.

Rejected direction 2 (make the named world's token reach its agents): that is full
named-world agent support (override LAUNCH per world, per-world boards/tokens), which
worlds.js explicitly scopes out of v1; large and security-adjacent.

## Tests

server.test.js (or a dedicated server.named-world-spawn-2827.test.js): with the board
booted into a named world (stub worldenv.bootedWorld to return a named id), POST
/api/agents and POST /api/team each refuse with the message and create nothing; with
bootedWorld = DEFAULT_ID (and = null) both proceed past the guard. Assert the guard
runs BEFORE createAgent/createTeam (no agent written on refusal).

## Weakest premise

Agents already created in a named world before this fix stay broken; the guard only
blocks NEW spawns. Acceptable for v1 (resolved by switching back to Kosmos 1) and
matches direction 1.

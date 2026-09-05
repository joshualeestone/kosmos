# Plan: #1704 slice 2b-i -- fix the require-time frozen-root cross-world data bleed

Builds on slice 2a (PR #2197, merged). 2a wired the world registry into the board
(startup + list/create API) and flagged, as the "TOP 2b BLOCKER", that modules which
freeze `store.ROOT` at require time would serve the DEFAULT world after a switch. This
slice fixes that -- the load-bearing correctness half of 2b. The switch route +
restart lifecycle (2b-ii) is a separate later PR.

## The bug (why it is a bleed, and why 2a's apply is too late)
- `store.ROOT` is a live getter (`root()` reads `process.env.AGENT_WORKFORCE_DATA` per
  call). But ~26 engine modules capture it ONCE, at module load:
  - `const BASE = store.ROOT` (commitments, you, policy, limits, remote, notify, ping,
    forget, engmode, heartbeat-setting, autoupdate), and
  - `const DIR = path.join(store.ROOT, 'x')` (a11ystatus, activity, liveness,
    disruption, attachments, messages, usage, firstrun, sendertoken, discover,
    cloudflare, githubdevice, tokendoor, remove, selfreport).
- server.js requires all of them at its top level, BEFORE `start()`. 2a called
  `worlds.applyActiveWorldEnv` INSIDE `start()`, believing the #1443 invariant ("roots
  are per-call") held fleet-wide. It does not for these ~26.
- 2a's `envOverridesFor` overrides the WHOLE data root
  (`AGENT_WORKFORCE_DATA/_PROJECTS/_WORKERS`), so the design intent is wholesale
  per-world isolation. On a board booted into a NAMED world, the frozen modules keep
  serving the DEFAULT world's `you.json / policy.json / commitments/ / limits.json /
  ...` while the rest of the board serves the named world = systemic cross-world bleed.

### Scope correction vs the slice-2a plan / restart handoff
The 2a plan and the restart handoff scoped this as "11 modules", from a grep for
`const .* = store\.ROOT`. That pattern is narrower than the class: it misses the
`const DIR = path.join(store.ROOT, 'x')` shape. The real set is ~26 (re-grepped on
origin/main). This tripled the size/risk of a per-module lazification and is what
drove the approach below.

## Decision: one place, before the requires -- not lazify 26 modules
`engine/worldenv.js` exposes `bootstrapWorldEnv(env)`: capture the pre-override
registry base, then `applyActiveWorldEnv` in place. server.js calls it at the very top,
BEFORE any `require('./engine/...')`. The frozen modules then capture the ACTIVE
world's root because the env is already correct when they load. One site fixes all ~26
present modules AND every future frozen module, with no per-module churn.

- `start()`'s apply is removed; `worldRegistryBase` is now set by the top-of-file
  bootstrap (still captured from the ORIGINAL env, before the override, so the
  `/api/worlds` routes resolve the world-independent registry).
- The boot diagnostic moved to stderr, so it never pollutes stdout.

### Why require-time is safe here (the boardauth objection, pre-empted)
server.js deliberately keeps `ensureToken()` out of require -- "a bare
`require('./server')` in a unit test must not touch the real store" -- because it
WRITES a file. `bootstrapWorldEnv` is READ-ONLY: it only reads the registry (usually
absent) and mutates the env object; it never writes or mkdirs. And unlike the token, it
CANNOT wait for `start()`: the freezes it must beat happen at require. For the default
world (every install today, every sandboxed test) the registry is absent and it is a
byte-for-byte no-op.

### Rejected: lazify all ~26 frozen modules (the 2a plan's letter)
The established codebase remedy for require-time freezes is "make it a function"
(`tools/check-frozen-roots.js`). But that checker's SOURCES are `os.homedir()/tmpdir()`
only; it explicitly EXCLUDES `store.ROOT` and notes its "20+ consumers... its own change
with its own review, not a rider" (lines 43-46). This slice IS that change, resolved in
one place instead of 26. Lazifying would be 26 edit sites (26 chances to introduce a
path bug in a data-integrity fix) and must be repeated for every future frozen module;
the single-site env-before-require has neither cost. Both converge to the same end state
(everything under the active world's root), since the env override is wholesale.

## Weakest premise (named, so it can be overturned in a sentence)
The fix depends on TWO things a future edit could break, both guarded:
1. **Require ordering** -- worldenv must be the first `require('./engine/...')` in
   server.js. Guarded by `server.worldenv-order.test.js` (strips block comments,
   handles multi-line destructuring requires, has a can-fail control).
2. **The require-time read** -- benign (read-only, fail-open, no-op for the default
   world), but it IS a new require-time filesystem touch. Accepted because it reads at
   most a small, usually-absent JSON and never writes.
What would change my mind: if a challenge finds an entry path that requires an engine
module before server.js's bootstrap (e.g. a preload, or a tool that requires a frozen
module directly and needs world awareness), the ordering guarantee would not cover it
and lazification (or a `-r` preload in the launcher) would be the more robust answer.

## Verification
- `engine/worldenv.test.js` (4): FIX (frozen modules resolve to a named world),
  CONTROL (default world moves nothing -- aimed at the exact arm under test),
  PERTURBATION (env applied AFTER the freeze = 2a's bug, reproduces the bleed),
  fail-open (broken env -> null, no throw). Real frozen modules
  (commitments/activity/limits/attachments), across separate processes (the freeze is
  per-process).
- `server.worldenv-order.test.js` (2): the ordering invariant + a can-fail control.
- `server.test.js`: 258/258, incl. the 2a #1704 route tests (default-world no-op holds).
- `engine/worlds.registry-1704.test.js`: 17/17 unchanged.
- `node tools/check-frozen-roots.js engine`: exit 0 (worldenv.js does not trip it).
- No web/ change, so no browser-check gate.

## Out of scope (2b-ii, later PR)
- `POST /api/worlds/active` (switch) + board-restart lifecycle (launchd relaunch,
  in-flight requests, agent-supervisor). `setActiveWorld` stays reachability-EXCUSED
  until that route gives it a caller.
- Launchd per-world isolation (`AGENT_WORKFORCE_LAUNCH` not overridden).
- Dedup-on-read (cosmetic).

## Queued after this (Splinter, 2026-09-04)
- #2192 = OpenAI/codex RUNNER activation (the OpenAI face of #2129); verify against
  #2129's codex-wedge fix first, then chase residual. Take at a clean 2b stopping point.

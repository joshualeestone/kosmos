# #1078 (re-scope): a created-never-run agent must appear on the BOARD roster

## The defect, restated at the correct surface
A Kosmos agent that was created but has NEVER RUN has a launchd job, a profile
and a worker dir, but no tmux pane and no self-report beat. The board reads the
fleet from `status.snapshot()` (tmux `list-panes` + the paneless-beat roster),
so a never-run agent is invisible there, and `boardEmpty()` then tells a person
holding unrun agents to "create your first".

My earlier `discover.foundCreated()` build (branch `neverrun-1078`) was
MERGED-BUT-INERT: both consumers of `found()`/`/api/found-agents` filter
`already !== true`, and a Kosmos-created agent is `already:true`, so every row
was correctly dropped there. `found()` never feeds the board. The fix belongs in
the board roster path, not discover. (Recorded on kosmos#1078 issuecomment-5549386051.)

## Design (the call, and what I rejected)
The Mac board roster gets a THIRD source, complementary to the two it already has:
1. tmux `list-panes` (pane cards) — agents with a live pane.
2. `panelessKeys()` (paneless-beat cards) — token-known agents beating with no pane
   (Windows / remote). Requires a sender token AND `liveness.alive()===true`.
3. NEW: created-never-run agents — a Kosmos launchd job + worker dir on disk, no
   pane, no live beat. This is the gap: (2) requires alive===true, so a never-run
   agent (never alive) is correctly excluded there.

**Mechanism (mirrors the win32 source seam exactly):**
- `engine/createdroster.js` `make(opts)` -> `createdRoster(excludeKeys)` returns
  the safeKey'd names of Kosmos-created agents on disk (valid job + worker dir
  exists + not removed) that are NOT already on the board (excludeKeys). Deps
  injectable for tests. Fail-closed like `discover.foundCreated`: enumerate plists
  under `create.AGENTS_DIR` by the `create.serviceLabel('')` prefix, validate each
  via `create.readJob` (a foreign/malformed plist -> skipped), require the worker
  dir to exist, and skip agents in `remove.removedNames()` (fail CLOSED: an
  unreadable removed.json returns [] rather than risk resurrecting a removed
  agent — remove.js's "caller about to act must refuse" doctrine). The
  `status.sandboxIsInconsistent()` guard is kept (mirrors foundCreated/foundCodex).
- `status.js`: a `createdSource = null` + `setCreatedSource(fn)` seam (mirrors
  `setPaneSource`/`setPaneCapture`). In `snapshot()`, AFTER the panelessKeys loop,
  build the full board-key set (paneKeys + the paneless keys just pushed), call
  `createdSource(boardKeys)` when set, and push one card per returned key via
  `panelessCard(key, nowMs, NEVER_RUN_DEFAULT)`.
- `panelessCard` gains an optional 3rd param `defaultStatus` (defaults to the
  existing UNKNOWN object, so the panelessKeys path is byte-identical). The created
  path passes `NEVER_RUN_DEFAULT = { state: STOPPED, confidence: STRUCTURED,
  because: 'it was created on this computer and has not been started yet' }`.
  Routing through `reconcileReport(selfreport.read(key), default)` means a truly
  never-run agent shows STOPPED, while an agent that ran-then-stopped-and-went-cold
  (plist present, pane gone, beat stale) correctly surfaces its last (decayed)
  report — the same behavior panelessCard already gives paneless agents.
- `server.js`: wire `setCreatedSource(require('./engine/createdroster').make())`
  on the Mac path (gated `!== 'win32'`). The enumeration is plist-based (launchd),
  so it is Mac-specific; the win32 never-run analog (a win32sessions-record source)
  is a separate follow-up, out of scope here.

**State choice — STOPPED, not a new state, not UNKNOWN:**
- A new STATE is high blast radius (every switch/render must handle it) for no
  gain: STOPPED already means "exists, not running", which is exactly what the
  person needs (they can start it). Rejected.
- UNKNOWN ("hasn't said anything yet") is the panelessCard default; it would count
  a never-run agent under `counts.unknown` ("?"), which reads as a read failure
  rather than an honest "not started". STOPPED/STRUCTURED is the truthful pairing
  (we read existence from a job record, not a scrape), matching classify()'s own
  STOPPED path (status.js:2504 "Claude is not running for this one").

**Dedup keyspace — verified, not assumed:**
- `paneKeys = store.safeKey(a.sessionName)`; a pane card's `sessionName` is the
  `-discord`-STRIPPED session name (status.js:847). `create` FORBIDS a `-discord`
  agent name (create.js:467), so a created agent's name has no suffix and
  `safeKey(createdName) === safeKey(pane.name)` for its running session -> a running
  created agent dedups to its (richer) pane card. panelessKeys keys share the same
  keyspace (the existing `paneKeys.has(key)` check relies on it). The created source
  safeKeys its names into the same space and is handed the union to exclude.

## Additivity
The `setCreatedSource` seam defaults to null -> `snapshot()` is byte-identical for
every existing test until a caller wires it. `panelessCard`'s new param defaults to
the current UNKNOWN object -> the panelessKeys path is unchanged. The created
enumeration fail-closes to [] on any read failure and refuses in an inconsistent
sandbox, so a test that does not set up AGENTS_DIR sees no created cards.

## Weakest premise (name it, do not bury it)
That STOPPED is the right board state for a never-run agent rather than a distinct
"created / not yet started" state. If a reviewer or Josh wants the board to
DISTINGUISH never-run from ran-then-stopped, that is a copy/state addition on top
of this detection change — but detection (making the agent APPEAR, killing the
"create your first" screen) is the ruled deliverable and does not depend on the
distinction. What would change my mind: a product signal that "stopped" misleads a
person about an agent that never started.

## Verification plan
- `engine/createdroster.test.js`: enumeration + fail-closed arms (removed.json
  unreadable -> [], malformed plist skipped, missing worker dir skipped, exclude
  set honored, sandbox-inconsistent -> []), each perturbation-verified.
- `status.snapshot` test with an injected `setCreatedSource`: a created key not on
  the board produces a STOPPED paneless card; a created key that IS a pane/paneless
  key is deduped out (no double card).
- Full `node --test engine/status*.test.js engine/createdroster.test.js` regression.
- `/challenge-loop`, blind, VARY reviewer models (Sonnet + Opus). Diff/proof against
  `origin/main...HEAD`.

# Plan: recordedRunner for a connected codex agent's brief (kosmos#2250)

## Problem

`instructions.fileFor`, `status.readIdentity` and `create.instructionFile` resolve
the agent **directory** via `store.safeKey` (broad acceptance) but the **runner**
via `create.readJob`, which returns `null` for a name outside `NAME_RE` because its
argument becomes a filesystem path through `plistPath` (a path-traversal surface).
So a **connected codex agent** whose name passes `nameUsable`/`safeKey` but fails
`NAME_RE` (uppercase, a dot, a space, a single char) has no readable runner, and its
brief/identity falls to `CLAUDE.md` — the file a codex agent does not boot from
(a codex agent boots from `AGENTS.md`, per #2245).

This is the residual after #2245 closed the create-time and switch-migration gaps.
Fail-closed, not a regression, and Kosmos-created codex agents are unaffected
(creation gates the name through `NAME_RE`). It bites **connected** codex agents
with an unusual name (e.g. `orch.main`, `Casey`).

## The call (implement this)

Add one shared `create.recordedRunner(name)`:
1. the launch job first — `(readJob(name) || {}).runner`, authoritative when a
   plist exists;
2. the profile's recorded `provider` as the fallback — `store.readProfile(name)
   .provider === 'openai'` ⟺ codex — the same source `server.js` already uses to
   derive a card's runner "whenever the pane is not the source" (`discover.connect`
   writes `provider: 'openai'` for a codex agent, keyed by `safeKey`, readable for a
   name `readJob` refuses).

Route all three sibling callers through it (`fileFor`, `readIdentity`,
`instructionFile`) so a new caller cannot inherit the gap again.

## What I rejected

- **Loosening `readJob`'s `NAME_RE` guard on `plistPath`.** That is the exact
  path-traversal surface Josh flagged as deserving its own scoped change. The fix
  must not touch it — and does not; it only *reads* the profile via the already-safe
  `readProfile`/`safeKey` path.
- **Profile-first resolution.** The live plist is authoritative for a running agent,
  and `setProvider` writes plist + profile together. Profile is a fallback only.
- **Fixing only `fileFor`** (the card's named function). `readIdentity` and
  `instructionFile` carry the identical bug; the module's own doctrine is "one
  reader, not two careful callers." One helper, three callers.

## Weakest premise

`provider === 'openai'` is the complete signal for codex. Verified: `provider` is only
ever `'openai'`, `'anthropic'`, or absent across `setProvider`/`discover.connect`, and
`server.js` maps it the same way. If a future provider denoted a non-claude, non-codex
runner, the mapping would need extending — but it would degrade to claude/CLAUDE.md,
the safe direction.

## Verification

- Unit tests for `recordedRunner`/`instructionFile`/`fileFor`/`readIdentity` with a
  discriminating control (a live plist wins over a contradictory profile — fails under
  a profile-first implementation) and a traversal control (`'../evil'` → claude, no
  throw).
- Full node suite green (4729/0), `yarn test:shell` green, #1720 browser-check gate
  green (no `web/` change).
- Challenge-loop converged in 2 iterations.

## Out of scope

Not a `web/` change, so no served-board check. The fix reaches installs on the next
release cut. Left as `Addresses #2250` (non-closing).

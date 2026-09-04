# Plan: fix #2130 - the global banner reads all accounts, not just the default config

## Problem
Settings > AI Models showed a Claude account "Signed in" while the global banner
at the bottom of every page read "Kosmos cannot tell whether a Claude
subscription is connected. We could not find a Claude account in the settings on
this computer." Both readers were honest and looked in different places:

- Settings uses `accounts.list()` (engine/accounts.js), which enumerates every
  account dir (`~/.claude` default AND every `~/.claude-*` sibling).
- The banner used `subscription.checkCached()` (server.js `/api/status`), which
  reads ONLY the default file `configFile()` = `AGENT_WORKFORCE_CLAUDE_CONFIG ||
  ~/.claude.json`.

An account can be signed in under its own `CLAUDE_CONFIG_DIR`, whose credential
lives in that dir's `.claude.json` (#1885), not in `~/.claude.json`. So a
connected account in a non-default dir was invisible to the banner while Settings
showed it - the exact "two readers of one fact diverge" defect.

## Change
Add `subscription.checkMachine(accountList)` - the machine-level connection:
- `base = check()` (default file; its because strings are already machine-level).
- If `base` is not connected, scan every OTHER signed-in account
  (`accounts.list()`) with `check({configDir})` and return connected if any is.
- When nothing is connected, return `base` unchanged (verdict AND wording), so the
  ONLY behaviour change is that a non-default connected account now suppresses the
  banner - the Settings-vs-banner disagreement #2130 is about.
- Memoized (`machineCached`) over every account's config file stat
  (mtime:size:ino), so a sign-in/out, subscription change, or default-file change
  invalidates.
- Accepts the caller's already-computed `accounts.list()`; the `/api/status` tick
  threads its `known` in so checkMachine does not run a SECOND per-tick
  `accounts.list()` (which would re-parse every config incl. the ~95KB default).

Rewire the one banner call site (server.js) to `checkMachine(known)`. Leave
`checkCached()`/`check()` unchanged for their callers (tests; connect.js and
firstrun.js reference them in comments, corrected to point at checkMachine).

## Rejected
- Re-reading only the default file and hoping sign-in lands there: that IS the bug.
- Making the banner per-agent: the banner is explicitly a machine-level fact
  (server.js comment); "any account connected -> connected" is the right machine
  semantic. Per-agent credential expiry (#1885) is a separate, per-agent problem.
- Duplicating the NONE/UNKNOWN because-strings in computeMachine: it derives them
  from check() instead (one source of truth).

## Weakest premise
Whether Josh's account is in a non-default dir (population mismatch, which this
fixes fully) OR his running server reads a different HOME/config than where
sign-in wrote (a pure env mismatch, the other #1885 arm). Cannot inspect Josh's
mini from here. This fix covers the population arm and is correct regardless; if a
pure env mismatch is ALSO in play it is a separate additive finding. Verify on
Josh's machine (batch).

## Tests
engine/subscription.machine-2130.test.js: default has no account but a non-default
dir is connected -> checkMachine CONNECTED while checkCached is NOT (the bug as a
control); default itself connected -> CONNECTED; nothing connected -> default
verdict unchanged with machine-level wording; fresh machine -> NONE; cache
invalidates on a non-default subscription change; and the threaded list is
consulted (checkMachine([]) -> not connected). 34 tests pass (6 new + 28 existing
subscription.test.js).

## Review
challenge-loop, 3 iterations to convergence. Iter 1: fixed a stale firstrun.js
cross-file comment (+ a sibling in connect.js found by a tree-wide sweep). Iter 2:
fixed a perf regression (checkMachine re-listed accounts every tick) by threading
the tick's known list in. Iter 3: converged (zero actionable); strengthened the
threaded-path test per a NIT.

## Verify (live)
Requires Josh's machine: a Claude account signed in under a non-default
CLAUDE_CONFIG_DIR with the default ~/.claude.json empty. Batches into the
clean-machine verify pass; not done-at-merge.

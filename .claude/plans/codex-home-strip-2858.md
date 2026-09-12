# Plan: strip ambient CODEX_HOME at the test runner (kosmos#2858)

## Problem

Invoking the node test suite (via `yarn test` / the canonical validation /
pre-challenge gate) from a Codex (gpt) agent's session inherits that agent's live
`CODEX_HOME` (e.g. a real `~/.codex-work2`). The tests that read `CODEX_HOME`
(`server.create-live-1903.test.js`, `server.openai-badge-2413.test.js`,
`openaiaccounts.delete-primary-2684.test.js`) then read real agent state and red
with 17 false failures that look like a regression but are not. Sub-Zero (mortals
Codex fighter) measured it with a one-variable control: the identical run with only
`unset CODEX_HOME` passes.

## Card location correction (measured)

The card proposes putting the strip in `tools/test-runner-reexec-1818.sh`, quoting
its `env -u KOSMOS_HARNESS_IGNORE_CUT -u KOSMOS_BC_FROZEN_RUNNER -u KOSMOS_BC_SELF_PID`
line. That file is a **test** (CONTROL/SUBJECT arms) that wraps the **browser-checks**
runner, not the node suite. `yarn test` runs `bash tools/run-tests.sh` -> `node --test`
(run-tests.sh:218 pre-change) and never routes through the reexec, so adding CODEX_HOME
to the reexec's `env -u` would not fix the 17 node-test failures. Confirmed
independently by PigeonPete, who arrived at the same correction.

## Fix

A single early strip in `tools/run-tests.sh`, after `cd "$REPO"`, before the suite:

```sh
unset CODEX_HOME AGENT_WORKFORCE_CODEX_HOME
```

This isolates the whole suite -- `node --test` AND `yarn test:shell`, every test
including ones not yet written -- from whoever invoked it. Both names on purpose: the
ambient leak is the bare `CODEX_HOME`, while #1412's outward-contamination fix routes
through the sandboxed `AGENT_WORKFORCE_CODEX_HOME`; stripping only one leaves the other
path open. A test that needs a Codex home sets its OWN sandbox value in-process, so
removing the inherited ambient value cannot break it. Nothing in run-tests.sh reads
either var, and `unset` of an already-unset var is a no-op under `set -u`.

Guarding the boundary once at the runner is the card's own argument: per-test fixes
protect only the tests someone remembered (the boundary re-opened two weeks after
#1412/#1411 fixed it per-test in the opposite direction).

## Guard test

`tools/test-run-tests-codexhome-2858.sh` (body converged independently with PigeonPete),
**wired into `test:shell`** in package.json right after the run-tests.sh syntax check
(an unwired guard runs nothing -- PigeonPete's diff added the file but not the wiring).
It reds if the strip is removed or moved after `node --test` (source-invariant legs)
and includes a behavioral leg proving the `unset` clears both vars for a node child.

## Verification

- Guard passes with the fix; reds without it (negative control: stash run-tests.sh,
  guard FAILS on the source legs).
- The 3 named test files self-defend on origin/main now (per-test fixed since the card
  was filed, likely by #2857), so the suite does not red on this box -- the durable
  runner strip + wired guard is the remaining piece, exactly the card's "per-test does
  not hold" argument.
- Full suite green with the fix (challenge-loop validation).

## Out of scope

- The per-test `delete process.env.CODEX_HOME` guards already present in some files
  (kept; the runner strip is the boundary guard, not a replacement).
- #2724 (cut-time gates reading live machine state) -- a sibling, different surface.

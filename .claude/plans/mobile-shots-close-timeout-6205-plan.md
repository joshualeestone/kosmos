# Plan: bound the mobile-shots browser-check closes (#6205)

## Problem
`docs/browser-checks/mobile-shots.js` awaited `ctx.close()` and `browser.close()` with no time
limit. When the engine process died underneath a run (a webkit crash, a context closing on its
own) those awaits never resolved: node stayed alive at 0% CPU, holding the shared run queue until
a person stopped it by pid. Observed 2026-10-14: a strict run hit a page.goto timeout on webkit,
the webkit context then closed on its own, and the process sat for 3h06m instead of failing in
seconds.

## Approach
Race each close against a timer, in a small new helper `docs/browser-checks/lib-bounded-close.js`:

- `withTimeout(promise, ms, label)` -- a ref'd watchdog timer (cleared on settle), race-safe against
  a late rejection (the #6022 unhandled-rejection class).
- `psParentMap()` / `childPidsOf(ppid)` -- the single `ps -A -o pid=,ppid=` reader (portable across
  macOS and Linux; `-e` means environment on macOS, so avoided), with childPidsOf derived from it.
- `descendantPids(roots, parentMap)` -- the whole process tree under a set of root pids (the real
  engine is often a grandchild: webkit/firefox launch through a wrapper).
- `killPids(pids, kill)` -- SIGKILL by pid, never a pattern; swallows an already-gone pid.
- `closeContextBounded(ctx)` -- returns false on a timeout so the caller can stop using a wedged
  browser; `closeBrowserBounded(browser, pids)` -- on a wedged close, SIGKILLs the engine's process
  tree, signalling only captured pids still our children at kill time (pid-reuse guard, so a
  departed-and-reused pid on this shared box is never hit).

In `mobile-shots.js`: capture the engine pids across the launch (intersecting two reads so the
transient `ps` child drops out), route every close through the bounded helpers, bound `newContext`,
and break the per-engine loop (counting an error) when a close or newContext times out, so a wedged
browser never opens another context; the `finally` force-kills the engine.

## Why the timeout is the load-bearing fix
The run ends via the timeout + `process.exit(code)`, so even a degraded pid capture cannot
reproduce the hang. The force-kill is secondary cleanup.

## Files
- `docs/browser-checks/lib-bounded-close.js` (new helper)
- `docs/browser-checks/mobile-shots.js` (wiring)
- `browser-checks-bounded-close-6205.test.js` (new unit test, repo root)
- `docs/browser-checks/README.md` (index the helper)

## Verification
Unit test (15 of 15) plus the browser-check itself as the behavioural regression guard. The full
node suite is the pre-PR validation gate.

# heartbeat.test.js: sandbox the data root so snapshot()'s paneless arm cannot leak real agents (#1112)

## Problem

`engine/heartbeat.test.js`'s `boardRows()` helper builds a real board via `fleet.install()` and
`rowsFrom` COUNTS the returned rows (`assert.equal(mapped.length, 1)`), so the roster must be
hermetic. But `snapshot()` derives the fleet from three sources, and one of them -- the paneless-beat
arm, `panelessKeys(paneKeys)` -- reads `sendertoken.keys()` + `liveness.alive()` off `store.ROOT`.
`store.ROOT` is frozen from `AGENT_WORKFORCE_DATA` (falling back to `AGENT_WORKFORCE_HOME`, then
homedir) at module load, and `sendertoken.DIR` / `liveness.DIR` freeze from it the moment those
modules load. On a cut box running the live fleet, or one that auto-imported real agent files (#2651),
real agents with a live heartbeat but no captured pane leak into the roster and red the count. This
only reproduces on a box that carries such agents (mortals), never on a quiet dev box.

## Fix (test-only, no product change)

Point the data root at a fresh empty temp sandbox at the TOP of `heartbeat.test.js`, BEFORE requiring
anything that transitively loads `store`/`sendertoken`/`liveness` (`../test-support/fleet` pulls in
`status`, which pulls in both). With `AGENT_WORKFORCE_DATA` aimed at an empty dir, `panelessKeys`
reads nothing, so the roster holds only the fixture agents. This is the exact pattern the sibling
test `status.paneless-roster.test.js` already uses (lines 25-30) to stay hermetic on any machine.

Diff: `engine/heartbeat.test.js` only -- the env-sandbox block + a `process.on('exit')` cleanup, plus
a comment on `boardRows` pointing at it. No product code (`engine/status.js`) changes; no new export;
no `engine.reachable.test.js` orphan-guard excuse.

## Rejected approaches (history, so a future reader does not re-walk them)

1. **#2696: sandbox `setCreatedSource`.** Wrong arm -- the leak is `panelessKeys`, not the
   created-never-run source. Validated on a quiet box (no imported agents) so it false-passed; on
   mortals `boardRows` still returned the real agents. Merged but inert (harmless). Lesson: validate
   on the box that FAILS (mortals).
2. **Global `AGENT_WORKFORCE_HOME` sandbox in `tools/run-tests.sh`.** Too broad -- broke 9 create/home
   tests, including control tests (`store.lazyroot-1443`, `store.dataroot-570`) that compare
   `store.ROOT` against `os.homedir()`-only. Abandoned (branch `runtests-store-sandbox`, never merged).
3. **A product `setPanelessSource` seam in `status.js`, sandboxed empty in `boardRows`.** Worked and
   validated green on mortals, but added a production export to `status.js` (high-scrutiny product
   code) purely for one test, which then needed a `#265` orphan-guard excuse -- the very smell that
   guard exists to flag. A blind review also found the `boardRows` set/restore was not exception-safe
   and the seam comment named the wrong caller. All three were symptoms of solving a test-only
   hermeticity problem in product code. Replaced by this test-only data-root sandbox, which the
   sibling paneless test already demonstrates and which touches zero product code.

## Validation

The load-bearing check is the FULL node suite on mortals (`bash tools/run-tests.sh`), because only a
box carrying real running agents can exhibit the leak. Expect 0 fail: the create/home tests, the
paneless-behaviour tests (`status.paneless-roster.test.js`, which sets its OWN data-root sandbox and
is unaffected), and heartbeat's `rowsFrom` count all pass. A quiet dev box cannot see the leak, so a
local green there proves only that nothing else broke.

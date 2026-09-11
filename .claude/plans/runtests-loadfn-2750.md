# #2750: read the 1-min load in run-tests.sh's banner through the shared function

**Branch:** `runtests-loadfn-2750` · **Card:** kosmos#2750 (follow-up to #2749; in my lane)

## The duplication

`tools/run-tests.sh:94` (inside `seen_before()`, the machine-state banner printed before the suite)
read the 1-minute load with an inline copy of the field-2 fact:

```sh
load="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')"
```

`tools/lib/cut-load-guard.sh` already owns that fact in `kosmos_box_load_1min` (and #2749 just
unified its extraction into one shared awk). So this was a second, independent derivation of
"field 2 of vm.loadavg is the 1-minute load" - the "two copies of one fact drift silently"
convention this repo names as its most-shipped defect class. Both #2749 challenge reviewers flagged
it.

## The fix

1. **Source the lib beside board-origin.sh** (line 31 region), for the same stated reason
   board-origin is sourced there: `seen_before()` runs before the `cut-guard.sh` source lower down.
   Same fail-open contract (`… 2>/dev/null || true`): a missing lib leaves the function undefined
   and the caller degrades.
2. **Call `kosmos_box_load_1min` instead of the inline read**, guarded by `command -v` exactly like
   the neighbouring `board_cwd_note` call (line 81), and with `load` pre-initialised (`local load=""`)
   because the guard may leave it unassigned and the file runs under `set -uo pipefail`.

The inline duplicate is removed entirely (not kept as a fallback), so there is now ONE owner of the
field-2 fact for both the cut gate and this banner.

## The call, what I rejected

- **Chosen: `command -v` guard + omit-the-line fallback.** Matches the file's own proven pattern
  (line 81) and its fail-open convention. If the lib is somehow missing, the banner omits the load
  line - the same graceful degradation it already shows when `sysctl` returns nothing.
- **Rejected: keeping the inline read as a fallback.** That would leave the duplicate standing, which
  is the whole thing this card removes.
- **Rejected: sourcing unguarded / without `command -v`.** Under `set -u` a missing function would
  make `$load` an unbound-variable abort of the CI entrypoint; the guard + init is the safe form.

## Verification

- `bash -n tools/run-tests.sh` clean.
- Functional (the exact guarded snippet, under `set -uo pipefail`, sourcing the lib as run-tests
  does): prints "1-minute load 8.64 on 10 cores" - identical banner, now via the shared function.
- Negative path (lib absent): `load` stays empty, the line is omitted, no `set -u` abort - fail-open
  confirmed.
- No new test file: `run-tests.sh` is the suite runner itself and has no per-function harness; the
  banner change is exercised every time CI runs `yarn test` (a broken read would abort run-tests.sh
  under `set -u` and red the `test` job), and `kosmos_box_load_1min` itself is already covered by
  `tools/test-cut-load-guard.sh` (including the deterministic field-index arm from #2749).

## Weakest premise

That sourcing `cut-load-guard.sh` into `run-tests.sh` introduces no name collision or side effect.
The lib defines only `kosmos_*` functions with no top-level execution (read in full), and run-tests
already sources two sibling libs the same way, so the risk is minimal; and if the source somehow
failed, the `command -v` guard degrades rather than breaking the runner.

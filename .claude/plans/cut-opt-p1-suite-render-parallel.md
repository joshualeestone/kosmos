# Cut-opt lever P1: overlap the node suite with the render checks (#2760)

Branch: `cut-opt-p1-suite-render-parallel`
Card: kosmos#2760 (step 2 of the "get cuts out faster" initiative; step 1 = the
per-step timing, PR #2755, merged; C1 node-runtime cache, PR #2774, merged).

## Measured bottleneck (from #2760, the 0.6.56 cut's per-step numbers)

- cut total: 1340s
- step 3b (headless render checks): 949s -- 71% of the cut, the single bottleneck
- step 3 (the node suite, `yarn test`): 277s
- notarize: 0s this cut -> P2 (notarize overlap) is dead weight, do not build it
- build: 23s

Steps 3 and 3b run SERIALLY today (277s + 949s). They are logically independent:
the node suite needs no browser; the render checks need no node suite; both run on
the already-frozen tree. Overlapping the 277s suite INTO the 949s render window
hides the suite almost entirely -> wall-time approaches max(949, throttled-suite)
instead of 949+277. Expected win: up to ~277s (~20% of the cut).

## The governing rule (from the card): TWO axes

Judge on BOTH wall-time AND render flake-rate. A change that shaves minutes but
raises step 3b's flake-rate is a BAD trade (a flaky cut = a red check + a re-run,
worse than a slow cut). Step 3b already starves under fleet load
(render-role-limit's fixed 200ms wait), so anything that adds load DURING 3b is the
exact risk to gate against.

## The design: concurrent-at-low-priority, opt-in, auto-gated, fail-safe

1. Run the node suite CONCURRENTLY AT LOW PRIORITY (`nice -n 19`) while the render
   checks run at NORMAL priority in the foreground. The render checks keep
   scheduling priority, so their flake-rate stays near-serial; the suite fills
   spare cycles.
2. **OPT-IN, DEFAULT OFF.** The overlap runs ONLY when `KOSMOS_CUT_PARALLEL=1`.
   With the flag unset (the default, always, until flake-rate is measured), the cut
   takes the CURRENT serial path BYTE-FOR-BYTE. This is the load-bearing safety
   property: **merging this change alters NO real cut.** The measurement+adoption
   (flipping the default) is a SEPARATE, later decision, made on measured
   flake-rate data -- which is exactly what the two-axis rule demands ("measure
   flake-rate before adoption"). You cannot measure-before-adopt if adopt == merge;
   the opt-in flag is what lets a measurement cut run the overlap before anyone
   commits the default to it.
3. **AUTO-GATE inside the opt-in** (`kosmos_cut_parallel_ok`, a pure decision in
   tools/lib/cut-load-guard.sh so it is unit-tested, not just bash -n'd):
   parallelize only when ALL hold --
   - `KOSMOS_CUT_PARALLEL=1` (opt-in; else serial)
   - cores >= `KOSMOS_CUT_PARALLEL_MIN_CORES` (default 8; a 2-/4-core box has no
     spare cycles for the suite while render keeps priority -> serial there)
   - 1-min load < `KOSMOS_CUT_PARALLEL_MAX_LOAD` (default 0.5 * cores; stricter
     than the entry gate's 1.5x, because we are ADDING the suite's load on top of
     render and want genuine headroom). The box was just gated quiet at release.sh
     line 656, so this reads a known-quiet box.
   Any unreadable value (no sysctl, garbage) -> SERIAL (fail-safe; serial is the
   safe, unchanged path -- the opposite fail-direction from the entry gate, which
   fails OPEN because there blocking is the harm; here falling back to serial is
   never harmful).
4. **Both gates still RUN and still ABORT on red, in both modes.** The suite
   analysis (#2006 isolation-rerun) and the page analysis are UNCHANGED and run in
   the same order (suite first, then page). In parallel mode the #2006 rerun runs
   AFTER both the foreground render and the backgrounded suite have finished (we
   `wait` the suite), so the rerun lands on a now-quiet box and correctly dismisses
   a contention red -- the #2006 guarantee (contention makes false reds, never
   false greens) is preserved.
5. **errexit-safe** (`set -euo pipefail`): a `( ... ) &` background job never trips
   errexit; `wait "$pid" || _suite_exit=$?` captures the suite's exit without
   aborting; the foreground render keeps its existing `|| _page_exit=$?`.
6. bash 3.2 compatible (macOS system bash): no bare `((...))`, float compares via
   awk, same as the rest of cut-load-guard.sh.

## Files

- `tools/lib/cut-load-guard.sh`: NEW `kosmos_cut_parallel_ok` (pure decision) +
  `kosmos_cut_parallel_max_load` / `kosmos_cut_parallel_min_cores` helpers.
- `tools/release.sh`: branch steps 3/3b on `kosmos_cut_parallel_ok`. Serial path
  (default) unchanged. Parallel path new, exercised only under the flag.
- `tools/test-cut-load-guard.sh`: extend with the new decision's cases (opt-in
  off/on, min-cores, max-load, fail-safe on unreadable) + a release.sh wiring
  assertion that the parallel branch is present and gated on the helper.

## What this deliberately does NOT do

- Does NOT flip the default. Adoption waits on a measured render flake-rate across
  measurement cuts (flag on), compared against #2755's per-step lines. That is a
  separate decision recorded on #2760 and flagged to Splinter (touches the release
  path).
- Does NOT build P2 (notarize overlap): notarize measured 0s, no win.
- Does NOT build C4 (render memoization): highest-risk (skips a safety gate),
  out of scope here.

## Known deferred nit

- A cut SIGKILL'd mid-foreground-render could orphan the backgrounded nice'd
  `yarn test` child (resource leak, not a correctness hole: it cannot let a red
  slip through, and it only exists in the opt-in parallel path). Mirrors the
  node-cache SIGKILL temp-orphan nit. Address if the challenge-loop flags it.

## Verification

- `bash -n` both files; extend + run test-cut-load-guard.sh (wired into test:shell);
  run the FULL `yarn test` (not just the one file) before pushing.
- Full `/challenge-loop` (this is CRITICAL cut tooling = high scrutiny).

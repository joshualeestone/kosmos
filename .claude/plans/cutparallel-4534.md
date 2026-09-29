# cutparallel-4534: test-cut-parallel-region inherits KOSMOS_CUT_PARALLEL (sibling of #4458)

## Problem
The 0.7.08 staging cut (Mortals, 2026-09-29, `KOSMOS_CUT_PARALLEL=1`, freeze 02b64aba5) aborted at its own
step 3 after 3744 s: every node test passed, and `tools/test-cut-parallel-region.sh` failed
"serial: ... ^ wrong branch: STEP output did not contain [STEP: == 3. ]". Its `run()` drives the extracted
region with `env PATH=... $extraenv bash -c`, which keeps the caller's environment, and a parallel cut runs
its suite with `KOSMOS_CUT_PARALLEL=1` exported. So the SERIAL arms took the parallel branch. CI and a
person's run never set the flag, which is why it was green everywhere else. #4458 fixed the same shape in
`test-cut-load-guard.sh` only.

## Change
Clear every `KOSMOS_` variable that `tools/lib/cut-load-guard.sh` and the extracted region read, listed
FROM those files (the #4458 pattern: a copied list goes stale silently), before any arm runs. Each arm then
sets exactly what it tests. Fail loud if the listing does not contain `KOSMOS_CUT_PARALLEL` (a vacuous
listing would clear nothing and read as a pass).

## Sweep
`grep -l KOSMOS_CUT_PARALLEL tools/test-*.sh`: only this file and test-cut-load-guard.sh (already fixed by
#4458, by the same listing).

## Proof
- Old file under the cut box's conditions (`KOSMOS_CUT_PARALLEL=1 KOSMOS_CUT_PARALLEL_MIN_CORES=1
  KOSMOS_FAKE_LOAD=0.1 KOSMOS_CUT_PARALLEL_MAX_LOAD=5`): the exact cut failure line, FAILS: 1.
- Fixed file, same env: FAILS: 0. Clean env: FAILS: 0.
- Note: `KOSMOS_CUT_PARALLEL=1` ALONE does not reproduce on a loaded box, because the parallel gate
  also needs spare cores and low load; the cut box (12 cores, load 3.79) had both.

## Weakest premise
The listing is a grep for `$KOSMOS_...` / `${KOSMOS_...` in the guard and the region. A variable read
another way (an indirect expansion, a sourced helper outside these two files) would not be cleared.

## Status
- [x] fix, red-check against the cut's own failure
- [ ] challenge loop, PR, merge; then the next parallel cut gives #2760 its wall time

---
pre_challenge: true
method: challenge-loop
branch: realroot-5418
diff_hash: 53f7e053e3059af91ea250ce00e2fb6ce57653cfd50d7066a9dc8883519e6119
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-10-07T03:26:19Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (alternating opus and sonnet); converged at 17, one further round (18) on a
post-convergence fix, which found nothing new.
**Converged:** Yes

### The full-suite measurement of THIS design (the plan points here)
- Final head 3f9ceb454, diff hash 53f7e053e305: **16034 tests, 15802 pass, 0 fail; ENTRY status clean**.
- The earlier head cdfad88b4 ran 16034 tests with 0 fail but went red on one repo audit:
  tools/check-frozen-roots.js flagged `const testRoots = new Set(); // comment` (it reads a const to the
  first line ending in `;`, so a trailing comment made it read into the next function's os.tmpdir()). Fixed
  at 3f9ceb454 by moving the comment to its own line; the audit exits 1 on cdfad88b4 and 0 on 3f9ceb454.
  Review round 18 ran on that change and found nothing new (its one WARNING, that os.tmpdir() is
  /var/folders when TMPDIR is unset, was measured false: it is /tmp).
- Two commits came after the loop first converged: cdfad88b4 (plan prose: the tally lives here) and
  3f9ceb454 (the audit fix above).
- The very first design (throwing) ran 15373 tests with 122 fail, 121 of them its own refusal; that is what
  moved the design to a throwaway root.
- Two earlier queued runs produced no verdict: one withdrawn by the 0.7.26 cut owner (20:25), the others
  replaced by newer heads.

ITER_COMMITS: abbba0b26 43c8e9590 e7dd4e960 800b89351 d936ac58c 2e2f9e840 527053552 6847b760e 06b8cc6d5
035bc6f13 1146c9611 aff4c274c 9dd92277a f62f2297f bf7038512 7c58642f8 3f9ceb454

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] engine/store.lazyroot-1443.test.js CONTROL read the real root under the throwaway --> FIXED (allow flag)
- [WARNING] engine/store.js a new temp home per env change --> FIXED (one per process)
- [WARNING] engine/store.real-root-5418.test.js HOME-elsewhere arm could not fail --> FIXED

#### Iteration 2 (sonnet)
- [WARNING] engine/store.js exporting AGENT_WORKFORCE_HOME moved other seams and overrode a later HOME --> FIXED (store-only throwaway)

#### Iteration 3 (opus)
- [BLOCKER] engine/create.js, engine/worlds.js, tools/selfreport-silence-monitor.js bypassed the rule --> FIXED (resolveDataRoot)
- [WARNING] engine/store.js named world inside the real root not caught --> FIXED ("inside")

#### Iteration 4 (sonnet)
- [WARNING] scope of protection --> DEFERRED, documented; shell side filed as #5428 (closed later by measurement)

#### Iteration 5 (opus)
- [WARNING] engine/store.js a named-world agent would fail every unsandboxed test --> FIXED (no refusal)
- [WARNING] engine/boardauth.js legacy token read the real legacy leaf --> FIXED

#### Iteration 6 (sonnet)
- [WARNING] tools/run-tests.sh stale "refused" comment --> FIXED

#### Iteration 7 (opus)
- [WARNING] sweep never ran on Windows --> FIXED (moved into the store)
- [CONVENTION] two definitions of the real root --> FIXED (one)

#### Iteration 8 (sonnet)
- [WARNING] engine/store.js KOSMOS_ALLOW_REAL_ROOT could migrate the real store --> FIXED

#### Iteration 9 (opus)
- [WARNING] engine/store.js --test-isolation=none not recognised --> FIXED (execArgv)

#### Iteration 10 (sonnet)
- [WARNING] inherited marker reaches non-test processes --> DEFERRED, documented

#### Iteration 11 (opus)
- [WARNING] engine/win32anchor.js anchor inside the data root off Windows --> FIXED
- [CONVENTION] engine/store.js duplicated test-process check --> FIXED (reuse)

#### Iteration 12 (sonnet)
- [WARNING] engine/store.js allow-flag migration skip too broad --> FIXED; sweep marker added

#### Iteration 13 (opus)
- [WARNING] tools/run-tests.sh a stray KOSMOS_TEST_RUN could make a real board a test --> FIXED (bound to the run's temp folder)

#### Iterations 14 to 16
- [WARNING] stale prose and unmeasured counts --> FIXED (measured: 38 captures in 35 files)

#### Iteration 17 (opus)
- [NIT] only --> CONVERGED

#### Iteration 18 (sonnet, on 3f9ceb454)
- [WARNING] tools/run-tests.sh fallback marker vs os.tmpdir() --> DEFERRED: measured false (os.tmpdir() is /tmp when TMPDIR is unset)
- [STRENGTH] tools/check-frozen-roots.js exits 0; one guarded resolver for every caller

### Deferred, with reasons (all in the plan)
- A stderr line when a throwaway is minted: tests in this repo assert empty child stderr.
- Parent and child no longer share an unsandboxed root: only pairs that both used the REAL store did.
- Not covered: children under a direct --test-isolation=none run, a plain `node file.test.js`, the workers,
  projects and per-account roots, Windows 8.3 short names, redirected AppData, firmlinks, pid namespaces
  sharing one tmp, uid and host name.
- Commit-subject and plan-name conventions: repo practice already varies.

### NITs recorded, not acted on (round 17)
- lazy require of live-execution on each read; a fallback marker of the plain TMPDIR; one tautological
  agreement test (helper and store now share one definition); case-folding on case-sensitive APFS.

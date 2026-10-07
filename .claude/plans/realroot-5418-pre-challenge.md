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

### Per-iteration outline (the plan file records the design changes each round drove)
1 (opus): lazyroot control broke; temp homes per env change; dead pid guard; HOME test could not fail;
  Windows APPDATA; stale run-tests comment --> FIXED
2 (sonnet): exporting AGENT_WORKFORCE_HOME moved other seams and overrode a later HOME --> FIXED
  (store-only throwaway); migration skipped for it
3 (opus): BLOCKER create.supportDir / worlds.baseRoot / silence monitor bypassed the rule --> FIXED (one
  guarded resolver); "inside" not only "equals"; pid-named sweep
4 (sonnet): scope of protection --> documented; shell side filed as #5428 (later closed by measurement:
  not live)
5 (opus): named-world agents would fail every unsandboxed test --> FIXED (no refusal, throwaway);
  boardauth legacy token routed; sweep test
6 (sonnet): stale comment; KOSMOS_TEST_RUN reach --> FIXED / measured
7 (opus): Windows sweep (moved into the store); Windows job runs the test; one "real root" definition
8 (sonnet): ALLOW must not migrate; sweep hardening (lstat, uid); tests use the product's definition
9 (opus): --test-isolation=none sets no NODE_TEST_CONTEXT --> FIXED (execArgv); symlink probe
10 (sonnet): inherited marker documented
11 (opus): win32anchor off Windows routed; reuse inTestProcess; reuse realish
12 (sonnet): ALLOW migration skip narrowed to the real root; sweep marker (pid, host)
13 (opus): KOSMOS_TEST_RUN bound to the run's temp folder; both leaves; host platform only
14-16: documentation and measured counts (38 captures in 35 files)
17 (opus): NITs only --> CONVERGED
18 (sonnet, on 3f9ceb454): nothing new

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

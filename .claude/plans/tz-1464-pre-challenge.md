---
pre_challenge: true
method: challenge-loop
branch: tz-1464
diff_hash: d83c169563c6a9a965b6508f254fce24b07453f1851e7dd48298f8482add4db3
validation: passed
subdir_audit: passed
timestamp: 2026-08-29T16:25:35Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3.
**Converged:** Yes.
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs.
**Fixed:** 4 | **Deferred:** 1 (the DST fall-back residual, documented) | **Asked:** 0.

Fixes #1464: the versions-page release gate parsed the rel-d stamp in the MACHINE's
local timezone while the writer stamps America/Chicago, so on a non-Central release box
a freshly written entry read ~300 min (CDT) or ~360 (CST) in the past and step 1 refused
every cut. The existing tests could not see it because the fixtures and the reader shared
the machine-local flaw and cancelled on a Central box. The fix forces Central everywhere a
stamp is produced or read, corrects the human-facing recovery path, and adds guard arms that
run under a non-Central TZ. Full suite 2937/2937; gate suite 73/73 under both TZ=America/Chicago
and TZ=UTC.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT.
- [WARNING] versions-entry.sh:211 -- November DST fall-back ambiguous hour: the repeated 1:00-1:59 Central hour reconstructs to the first (CDT) instant. --> DEFERRED: fail CLOSED (a CST-hour stamp reads ~60 min too stale and is refused, never wrongly accepted), once a year, one hour; not fixable without trusting the label the reader deliberately ignores. Documented in a comment.
- [NIT] versions-entry.sh:213 -- the reader regex hard-coded a plain space before AM/PM, but toLocaleString emits a U+202F narrow no-break space on some ICU builds. --> FIXED (08686d4e): regex uses \s, which matches both; new mutation-verified guard arm.

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs.
- [WARNING] versions-entry.sh:328 -- the refusal's clock display (\$now) was still machine-local, so on a non-Central box the operator, following "paste the clock line", pasted a line the now-Central reader rejects. --> FIXED (d809557a): TZ=America/Chicago date; new recovery guard arm reads the printed clock back under TZ=UTC.
- [WARNING] docs/releasing.md:169-181 -- the recovery section still described the old machine-local comparison and framed #1464 as an open carded bug. --> FIXED (d809557a): rewritten for the Central behavior; copy the printed Central clock, not machine date; #1464 marked fixed.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT.
**Converged** -- the reviewer verified the fix end-to-end (reader Central across UTC/NY/Tokyo/Kolkata/Kiritimati; every operator-facing time display Central; docs consistent; guard arms non-vacuous) and found nothing actionable.
- [NIT] test-versions-entry-gate.sh:458 -- the U+202F arm has no in-arm literal-space counterpart; the "matches both" claim rests on the plain-space arms elsewhere. --> DEFERRED: reviewer deemed it acceptable (both branches are exercised across the file); co-location only, not a coverage gap.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/versions-entry.sh:211 | DST fall-back ambiguous hour reconstructs to CDT | DEFERRED | Fail-closed, once/year/one-hour, unfixable without the label; documented |
| 2 | 1 | NIT | tools/lib/versions-entry.sh:213 | regex intolerant of U+202F separator | FIXED | 08686d4e: \s + guard arm |
| 3 | 2 | WARNING | tools/lib/versions-entry.sh:328 | refusal clock display machine-local (recovery trap) | FIXED | d809557a: TZ=America/Chicago + recovery guard arm |
| 4 | 2 | WARNING | docs/releasing.md:169 | recovery docs described old machine-local behavior | FIXED | d809557a: rewritten Central, #1464 marked fixed |
| 5 | 3 | NIT | tools/test-versions-entry-gate.sh:458 | U+202F arm lacks in-arm literal-space control | DEFERRED | Acceptable; both branches exercised elsewhere |

### Outstanding questions (ASKED, still unresolved when the run ended)

None.

### NITs (non-blocking, across all iterations)

- [NIT] the U+202F regex separator (iteration 1) -- FIXED.
- [NIT] the U+202F arm's in-arm control (iteration 3) -- acceptable co-location note.

### Strengths (across all iterations)

- The core fix is correct and DST-aware: forcing TZ=America/Chicago on the reader reconstructs the stamp as a Central instant on any machine, verified round-trip 0 in both CDT and CST and across UTC, NY, Tokyo, Kolkata (half-hour), Kiritimati (+14) (iterations 1-3).
- Every operator-facing time display is Central on any machine: the refusal clock, the writer's CDT/CST label, and the release.sh remediation all agree; a grep found no remaining machine-local operator time output (iteration 3).
- Ignoring the trailing label in the reader is strictly more robust: even a legacy entry with a hard-coded-wrong CDT in winter reads correctly (iteration 1).
- The guard arms are non-vacuous and force their own TZ, so they catch a machine-local regression even on a Central box; mutation-verified (cross-TZ 301, separator, recovery -299) (iterations 1-3).
- All three rel-d producers now build Central stamps, closing the fixture-cancels-the-bug hole that hid the defect from the old tests (iteration 3).

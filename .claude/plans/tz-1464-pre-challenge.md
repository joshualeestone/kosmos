---
pre_challenge: true
method: challenge-loop
branch: tz-1464
diff_hash: a1968c62f01c2f497268c68eb56e333bde42de427c2d3e82b694dc8eb46f45b9
validation: passed
subdir_audit: passed
timestamp: 2026-08-29T16:37:51Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (3 on the code, then 1 re-entry after the required plan file was added).
**Converged:** Yes.
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs.
**Fixed:** 4 | **Deferred:** 2 (the DST fall-back residual; the U+202F arm co-location) | **Asked:** 0.

Fixes #1464: the versions-page release gate parsed the rel-d stamp in the MACHINE's local
timezone while the writer stamps America/Chicago, so on a non-Central release box a freshly
written entry read ~300 min (CDT) or ~360 (CST) in the past and step 1 refused every cut, for
everybody. The existing tests could not see it because the fixtures and the reader shared the
machine-local flaw and cancelled on a Central box. The fix forces Central everywhere a stamp
is produced or read, corrects the human-facing recovery path (the refusal clock display and
the docs), tolerates the U+202F separator, and adds guard arms that run under a non-Central TZ.
Full suite 2937/2937; gate suite 73/73 under both TZ=America/Chicago and TZ=UTC.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT.
- [WARNING] versions-entry.sh:211 -- November DST fall-back ambiguous hour reconstructs to the first (CDT) instant. --> DEFERRED: fail CLOSED, once a year, one hour; unfixable without trusting the label. Documented.
- [NIT] versions-entry.sh:213 -- regex hard-coded a plain space before AM/PM; toLocaleString emits U+202F on some ICU builds. --> FIXED (08686d4e): \s + mutation-verified guard arm.

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs.
- [WARNING] versions-entry.sh:328 -- the refusal clock display was machine-local, so on a non-Central box the on-screen recovery sent the operator in a circle. --> FIXED (d809557a): TZ=America/Chicago date + recovery guard arm.
- [WARNING] docs/releasing.md:169 -- the recovery section described the old machine-local behavior and framed #1464 as open. --> FIXED (d809557a): rewritten Central, #1464 marked fixed.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT.
**Converged (code).** The reviewer verified the fix end-to-end and found nothing actionable.
- [NIT] test-versions-entry-gate.sh:458 -- the U+202F arm has no in-arm literal-space control. --> DEFERRED: acceptable, both branches exercised across the file.

#### Iteration 4 (re-entry)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT.
**Converged.** The required plan file (.claude/plans/tz-1464.md) was added and this pass re-reviewed the whole diff including it. The reviewer re-verified the timezone code, DST behavior, all three guard arms (non-vacuous, mutation-catching), and the plan's accuracy against the code.
- [NIT] .claude/plans/tz-1464.md:39 -- the plan prose says "each [guard arm] forcing its own TZ", which is true of the cross-TZ and recovery arms but not the separator arm (it needs no TZ force; the reader forces Central internally). --> DEFERRED: a minor over-generalization in the plan prose; the separator arm itself is correct and mutation-verified. Left as-is to avoid re-spinning the loop for a doc imprecision; recorded here for transparency.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/versions-entry.sh:211 | DST fall-back ambiguous hour reconstructs to CDT | DEFERRED | Fail-closed, once/year/one-hour; documented |
| 2 | 1 | NIT | tools/lib/versions-entry.sh:213 | regex intolerant of U+202F separator | FIXED | 08686d4e: \s + guard arm |
| 3 | 2 | WARNING | tools/lib/versions-entry.sh:328 | refusal clock display machine-local (recovery trap) | FIXED | d809557a: TZ=America/Chicago + recovery guard arm |
| 4 | 2 | WARNING | docs/releasing.md:169 | recovery docs described old machine-local behavior | FIXED | d809557a: rewritten Central, #1464 marked fixed |
| 5 | 3 | NIT | tools/test-versions-entry-gate.sh:458 | U+202F arm lacks in-arm literal-space control | DEFERRED | Acceptable; both branches exercised elsewhere |
| 6 | 4 | NIT | .claude/plans/tz-1464.md:39 | plan prose over-generalizes "each arm forces its own TZ" | DEFERRED | Separator arm needs no TZ force; doc imprecision only |

### Outstanding questions (ASKED, still unresolved when the run ended)

None.

### NITs (non-blocking, across all iterations)

- [NIT] the U+202F regex separator (iter 1) -- FIXED.
- [NIT] the U+202F arm's in-arm control (iter 3) -- acceptable co-location note.
- [NIT] the plan prose over-generalization (iter 4) -- doc imprecision, recorded.

### Strengths (across all iterations)

- The core fix is correct and DST-aware: forcing TZ=America/Chicago on the reader reconstructs the stamp as a Central instant on any machine, verified round-trip 0 in CDT and CST and across UTC, NY, Tokyo, Kolkata, Kiritimati.
- Every operator-facing time display is Central on any machine (refusal clock, writer label, release.sh remediation, docs); a grep found no remaining machine-local operator time output.
- Ignoring the trailing label in the reader is strictly more robust: even a legacy entry with a hard-coded-wrong CDT in winter reads correctly.
- The guard arms (cross-TZ, U+202F, recovery) are non-vacuous and mutation-verified (301, unparseable, -299); the cross-TZ and recovery arms force their own TZ so they catch a machine-local regression even on a Central box.
- All three rel-d producers now build Central stamps, closing the fixture-cancels-the-bug hole; the plan doc accurately describes the shipped code (bar the one prose imprecision noted).

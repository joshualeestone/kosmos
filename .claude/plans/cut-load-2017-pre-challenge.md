---
pre_challenge: true
method: challenge-loop
branch: cut-load-2017
diff_hash: 2ee2803af4710438f0b66c5994d7dd92728628f7aaf1ec4c0a22c3168cbcb20c
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T14:10:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind-review passes
**Converged:** Yes (iteration 2 found no blocking issues)
**Total findings:** 3 WARNINGs, 4 NITs, 0 BLOCKERs
**Fixed:** 2 WARNINGs + all NITs | **Deferred:** 1 WARNING (by-design, documented) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs
- [WARNING] residual-load lag before step 3b: the pre-3b 1-min load is still inflated by the cut's own just-finished suite, so a pre-3b wait would stall on the cut's residual and misname its own processes. --> FIXED: gate the ENTRY to the gated phase (before step 3) instead; removed the pre-3b wait. A quiet box at the entry plus the held reservation covers step 3 and 3b, and the entry is where the incident's leftover load lives.
- [WARNING] the release.sh wiring (the abort-on-timeout) was only bash -n'd, not unit-tested. --> FIXED: moved the abort decision into `kosmos_gate_or_abort` (a lib function); release.sh is now a thin `kosmos_gate_or_abort ... || exit 1`. Added 3 assertions covering it.
- [NIT] locale: awk float compare/format could follow a comma-decimal LC_NUMERIC. --> FIXED: `LC_ALL=C` on both awk calls.
- [NIT] compounding 20-min wait across two gates. --> moot after the single-entry-gate reshape.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 NIT
- [WARNING] single-gate-at-entry residual: a heavy EXTERNAL job that STARTS during step 3 can saturate the box by step 3b, which is not re-checked. --> DEFERRED (by-design, documented in the plan Scope): a naive pre-3b re-check would false-wait on the cut's own just-finished suite residual; the residual is only ever a false-RED at 3b (a wasted cut), never a false-green; the incident (leftover load from the cut's start) IS covered by the entry gate. The reviewer surfaced it "for awareness, not as a required change." A foreign-load check at 3b is a noted follow-up.
- [NIT] the live `sysctl`/`ps` parse was never exercised (only the `KOSMOS_FAKE_LOAD` seam), so a wrong-field regression would not be caught. --> FIXED: added 3 live-data assertions (the 1-min load is numeric and matches sysctl field 2 directly; the top-consumers output never leaks the ps header).
**Converged** -- 2 STRENGTHs confirmed the entry-check placement is genuinely correct (steps 1-2b before the gate are light git/node ops; the heavy work runs after), and the return-code discipline is clean (fail-open safe, no off-by-one, `|| exit 1` correct under set -euo pipefail, abort lands after the EXIT trap so the reservation/freeze/BUILD_ROOT are released).

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | WARNING | residual-load lag before step 3b | FIXED (single entry gate) |
| 2 | 1 | WARNING | abort wiring untested | FIXED (kosmos_gate_or_abort, unit-tested) |
| 3 | 2 | WARNING | mid-cut external load at 3b | DEFERRED (by-design, documented, safe-direction) |
| 4-7 | 1-2 | NIT | locale, compounding wait, live-parse coverage | all FIXED/moot |

### Strengths (iteration 2)
- Entry-check placement genuinely correct (traced: light ops before the gate, heavy work after), so the entry load measures pre-existing/external load, not the cut's residual.
- Fail-open on unreadable load is the safe direction; poll loop terminates deterministically; `|| exit 1` correct under set -euo pipefail; abort lands after the EXIT trap (reservation released); LC_ALL=C on every awk; the abort decision is unit-tested in the lib.

### Validation
- `bash tools/test-cut-load-guard.sh` -> 19/19 assertions pass (bash 3.2.57): threshold (default + override), float compare (over/not/fail-open), the wait's three paths, `kosmos_gate_or_abort` (quiet/saturated with the abort narration), an errexit-safety guard, and the LIVE sysctl/ps parse (field index + header skip).
- `bash -n` clean on the lib and release.sh.
- No `web/` change (no #1720 gate). Added a `test-*.sh` not a `*.test.js` (the #1934 node-coverage count is unaffected). No node engine change, so the node suite is unaffected by this diff.
- The full local suite could not be run: `tools/run-tests.sh` correctly refused because the box was reserved for a live 0.6.25 cut via #1962, which must not be overridden during a release. The authoritative full-suite validation (node + `test:shell`, which runs `bash tools/test-cut-load-guard.sh` in-chain) is GitHub CI on the pushed branch; merged only after CI is green.

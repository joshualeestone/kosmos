---
pre_challenge: true
method: challenge-loop
branch: refusedbody-6192
diff_hash: 32eee6add36daed1ea55a18aa9745133b3858ed0891d3c4633d4bf552e4f473d
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T03:18:53Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 8 actionable (0 BLOCKERs, 8 WARNINGs, 0 CONVENTIONs), plus NITs
**Fixed:** 5 | **Deferred:** 3 | **Asked (awaiting user):** 0

Baseline validation (6.0) was not run before iteration 1: rounds ran on the 265 test files that read the page or the
browser checks (3889 tests, green each round) and on the new check run by hand against a sandboxed in-process board,
both trees each round (main's page fails QUIET with the card's list; this branch passes; CONTROL passes on both).
The closing 6j gate ran through tools/queued-heavy.sh on 28269b8: FINAL-VALIDATION v=0 a=0, node suite 20657 tests,
0 failed, 0 FAIL lines. That run executes no page browser checks (0 render- verdicts); the new check's first pipeline
run is this PR's CI browser-checks job (page scope selects it for any web/index.html change).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] render-refusedbody-6192.js CONTROL: an unkept response could be collected and its request closed (GC timing) --> FIXED (8608975: the answer is kept)
- [WARNING] render-refusedbody-6192.js QUIET: a poll sent just before the look counts as stuck --> FIXED (8608975: only requests open longer than 2 s count)
- [WARNING] web/index.html comment stated a general browser rule from one measurement --> FIXED (8608975: measured in Chromium against the board's 404s)
- [NIT] two different numbers quoted; headless default differs from neighbours; README row placement --> fixed

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] a page error under refused reads failed the check for an unrelated reason --> FIXED (1406828: noted, not failed)
- [WARNING] QUIET could pass on a page that made no reads --> FIXED (1406828: at least 10 refused reads must be seen)
- [WARNING] web/index.html: the drain buffers a refused body again, and an endless one whole --> DEFERRED: no streaming or getReader in the page, refusals are small JSON; recorded in the plan's weakest premise
- [NIT] control reroute not mentioned; plan numbers --> fixed

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the page scope line runs the check in PR CI on a Linux runner, where neither arm was measured --> DEFERRED: this PR's own CI is that measurement (it changes web/index.html, so the check is selected) and a red blocks the merge; recorded in the plan
- [NIT] README row wording; "every fetch" in the page comment --> fixed (28269b8; no XHR or EventSource in the page, checked)
- [NIT] non-GET requests reach the shared board --> not changed (no load-time write found)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] a future read held open by design would fail QUIET --> DEFERRED: not an issue here; every GET is rerouted to the board's 404 by the check's route, so no read can be held while it runs

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (Linux runner unmeasured, iteration 3)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | render-refusedbody-6192.js | BRANCH | control relied on GC timing | FIXED | 8608975 |
| 2 | 1 | WARNING | render-refusedbody-6192.js | BRANCH | QUIET counted fresh polls | FIXED | 8608975 |
| 3 | 1 | WARNING | web/index.html | BRANCH | comment overclaimed | FIXED | 8608975 |
| 4 | 2 | WARNING | render-refusedbody-6192.js | SELF | page error failed the check | FIXED | 1406828 |
| 5 | 2 | WARNING | render-refusedbody-6192.js | SELF | QUIET could pass vacuously | FIXED | 1406828 |
| 6 | 2 | WARNING | web/index.html | BRANCH | drain buffers a refused body | DEFERRED | small JSON, plan |
| 7 | 3 | WARNING | render-refusedbody-6192.js | BRANCH | unmeasured on the Linux runner | DEFERRED | this PR's CI measures it |
| 8 | 4 | WARNING | render-refusedbody-6192.js | BRANCH | a held read would fail QUIET | DEFERRED | every read is refused here |

### NITs (non-blocking, across all iterations)
- [NIT] the control's path match is a substring; `ctl === 1` could be `>= 1` (iteration 4)
- [NIT] a stub fetch returning a non-promise would now throw (none found among sampled stubs) (iteration 5)
- [NIT] long lines in the check header (iteration 5)

### Strengths (across all iterations)
- one wrapper for every fetch() call, draining a clone without awaiting it; the caller's original is untouched and plain-object stubs are skipped (iterations 1 to 5)
- the check reaches the board's real 404 over the network, has a floor, an age filter and a kept control, and was measured to fail on main and pass here (iterations 1 to 5)
- wiring complete with no new board boot: run_one in the $B8 group, b8-board.txt, README row, page scope line (iterations 1 to 5)

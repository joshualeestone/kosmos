---
pre_challenge: true
method: challenge-loop
branch: browser-run-guard-2271
diff_hash: 5b4c5c8144f9d6cedc628f110360029aea8c5947a3803dafb543257cc26af8ce
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T21:19:22Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (zero NEW actionable BLOCKER/WARNING/CONVENTION against this change)
**Total findings:** 0 BLOCKERs, 1 WARNING (pre-existing, out of scope), 0 CONVENTIONs, 1 NIT, 5 STRENGTHs
**Fixed:** 0 | **Deferred/routed:** 1 pre-existing WARNING | **Asked:** 0

**Validation note:** test-only change to tools/test-browser-run-guard.sh (the marker-dir seam already
existed in tools/lib/cut-guard.sh:107; no source change). The test passes fully on a busy shared box
(12 pre-existing arms + 2 new), including the previously-failing "passes when nothing is live".
Sibling test-cut-guard.sh PASS; every-test-runs meta-guard 3/0; test-zsh-tied-names PASS. Direct
red-capability: the guard refuses (rc=1) with a live marker in the dir and passes (rc=0) with it
removed - the two new arms encode both directions.

### Per-Iteration Breakdown

#### Iteration 1 (reviewer a6bf5b1a)
**New findings:** 0 BLOCKER, 1 WARNING (pre-existing/out-of-scope), 1 NIT. **Converged.**
- [STRENGTH] KOSMOS_RUN_MARKER_DIR export precedes every guard call -> all arms isolated; the seam already existed and the test just never drove it.
- [STRENGTH] No pre-existing arm weakened (all drive KOSMOS_BC_PROBE; only "passes when nothing is live" was broken by the leak, which isolation repairs).
- [STRENGTH] The new marker arm is a faithful #2215 marker (line1 cookie, line2 `ps -ww -o command=`), keyed on the token "marked" unique to the marker path, driven by probe-quiet so only marker_other can refuse.
- [STRENGTH] Red-capable by construction: the empty-dir arm is the equivalent negative control of the marker arm (same call, marker removed, rc flips 1 -> 0).
- [STRENGTH] The guard's real purpose stays provable (the "refuses while a page layer is live" and KOSMOS_BC_REALPATH arms untouched).
- [WARNING - PRE-EXISTING, OUT OF SCOPE] the opt-in KOSMOS_BC_REALPATH arm's `live_count` helper parses a refusal token the guard no longer emits, so under KOSMOS_BC_REALPATH=1 its delta assertion would fail. Untouched code, opt-in path (skipped by default, never in the cut) -> does not block this change; routed to a separate card.
- [NIT] the marker arm's `sleep 30 &` orphans on interrupt, matching the existing #1391 arms (self-terminates in 30s + the EXIT trap). No action.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | test-browser-run-guard.sh:~111 (pre-existing) | REALPATH live_count parses a stale message token | ROUTED | pre-existing, opt-in path; separate card, not this PR |
| 2 | 1 | NIT | test-browser-run-guard.sh:~48 | sleep orphan on interrupt | ACCEPTED | matches existing #1391 arms; self-terminates |

### Outstanding questions (ASKED)
None.

### Strengths
See per-iteration (isolation reaches all arms; no arm weakened; marker arm faithful + red-capable-by-construction; guard purpose provable).

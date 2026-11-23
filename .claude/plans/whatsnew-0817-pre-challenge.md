---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0817
diff_hash: ba5b99c342d203f9eb6e7c36eb7c0e8ad96e4488018f74010dd08b3096083a1a
validation: passed
subdir_audit: passed
timestamp: 2026-11-23T04:56:36Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 0 | **Deferred:** 0 | **Asked (awaiting user):** 0

The 6.0 initial validation passed on the committed branch (hash ba5b99c342d2, 0 failed, audit clean), so the first blind review is iteration 1. Before it, Mona Lisa's copy read (22:05) was applied: two lines reworded for a person, and a rank swap so Linux sees 3 lines.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [NIT] commit trailers — the attribution names one model, while the reviewer expected another; cosmetic
- [NIT] release/whats-new-pool.json — "A warning before an agent runs twice" keeps `since: 0.8.01`; accurate, and the plan says why it appears late
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|

(No BLOCKER, WARNING or CONVENTION findings.)

### NITs (non-blocking, across all iterations)
- [NIT] commit trailers — attribution model name (iteration 1)
- [NIT] release/whats-new-pool.json — a line with an early `since` (iteration 1)

### Strengths (across all iterations)
- prod-check 0, and an offline build of the committed pool is byte-identical to web/whats-new.json (iteration 1)
- The two Windows-only lines retired by hand were in a window Windows prod serves (latest-win.json 0.8.16), so they cannot show twice; shownIn is set on exactly 0.8.16's five window lines (iteration 1)
- Windows 4, Mac 4, Linux 3; no platform empty; the two notes-only lines stay out of the window (iteration 1)
- The copy is plain and the pool holds no em dashes (iteration 1)

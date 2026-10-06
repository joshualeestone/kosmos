---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0725
diff_hash: 09f003479ba342fc8dcda9a5f521264dd24dfd4b66ad7b8768d8d92ad1d28b25
validation: passed
subdir_audit: passed
timestamp: 2026-10-06T06:01:55Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (Opus), plus Mona Lisa's copy check
**Converged:** Yes (iteration 1: NITs only)
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs

### Validation (what "passed" rests on)
- A copy-only change to web/whats-new.json (plus its plan) on origin/main; tools/whats-new-check.js 0.7.25 passes (mac 4,
  windows 3). The #1720 gate is satisfied by the Browser-check trailer on each commit.
- The 0.7.25 cut's step 3+3b runs the full suite and the full page layer on the pinned tree, and aborts before anything
  is published on any red. That is this change's gate (as for the 0.7.24 What's New).

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [NIT] web/whats-new.json line 4 — the fixed right-edge fade predates #5303 (#718); what is new is the arrow and the scroll-aware fade --> FIXED (ffd8c47f8)
- [NIT] web/whats-new.json line 3 — "the original is kept" is true (store.saveRefitAvatar keeps it first) but nothing restores it in the UI; kept as is
- [STRENGTH] the Mac-only tag on the Claude sign-in line is right: claudeloginlive reads only on darwin
- [STRENGTH] "With Community on" and "automatically" match pictureToFit and refreshIndustry
- [STRENGTH] no line features API keys

### Copy check (Mona Lisa, 01:00): lines 2 and 4 reworded ("expired Claude sign-in", "more sections", "arrow"); 1 and 3 OK.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | web/whats-new.json | BRANCH | fade partly predates #5303 | FIXED | ffd8c47f8 |
| 2 | 1 | NIT | web/whats-new.json | BRANCH | "original is kept" not restorable in UI | DEFERRED | literally true |

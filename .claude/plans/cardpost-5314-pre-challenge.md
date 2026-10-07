---
pre_challenge: true
method: challenge-loop
branch: cardpost-5314
diff_hash: e347f462b4e9489b69311747ab40b83d2ec7e4aefebf1c2e4ef37f8685c73ffe
validation: passed
subdir_audit: passed
timestamp: 2026-10-07T23:17:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (reviewer models rotated: Sonnet, Opus, Sonnet, Opus)
**Converged:** Yes (iteration 4 found zero new actionable BLOCKER/WARNING/CONVENTION after dedup)
**Total findings:** 0 BLOCKERs, 9 WARNINGs, 5 CONVENTIONs, 11 NITs (across all iterations, deduplicated)
**Fixed:** 4 | **Deferred:** the rest (documented non-defects / follow-ups) | **Asked:** 0

Note: the branch was REBASED onto current origin/main between iterations 2 and 3 (per PM
direction), so iterations 3-4 reviewed the actual merge result. The rebase was clean (0 conflicts).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 0 (ITER_COMMITS empty on the first pass)
- [WARNING] server.js — supplied-path undefined->null normalization --> DEFERRED: required for the card tests' partial `supplied` (else hasOwnProperty.call(undefined) throws), and pinned by them
- [WARNING] server.js — midnight bucketing clock skew / null-store untested --> DEFERRED: the server-sent label string is authoritative; null branch documented, primary paths tested
- [WARNING] engine/communitystore.js — publishedPostTimesAll duplicates postTimesAll, no shape test --> escalated by iter2 and FIXED (convention #5)
- [WARNING] engine/communitystore.js — receivedAt is not a publish time --> DEFERRED: by design (store keeps no publish time), noted on PR
- [WARNING] docs/browser-checks/mobile-shots.js — verify may false-fail on a re-render; no occlusion check --> DEFERRED: fail-loud is the safe direction; verified by eye and 20 shots passed
- [WARNING] docs/browser-checks/mobile-shots.js — scrolled element not guaranteed the "today" card --> DEFERRED: any framed line demonstrates the design; eye-verified "today" is framed
- [CONVENTION] web/index.html — typeof guard "smell" + a stray blank line --> DEFERRED: the guard is load-bearing (documented); the blank line is cosmetic
- [CONVENTION] web/index.html — communityLine documented rule --> DEFERRED: by design
- [NIT] test setOn not reset; CSS test asserts selectors only; list/now shadowing (harmless)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings (confirmed):** the mobile-shots + null-store concerns (iter1)
- [CONVENTION] engine/communitystore.js — the postTimesAll duplication needs a SHAPE-pinning test, not just a sync comment (convention #5) --> FIXED (9d58beb7a): added a shape-equality test (both readers derive the same key/time for published posts); kept the copy byte-identical per the reviewer's ruling
- [CONVENTION] web/index.html — communityLine re-derives the day-diff client-side, duplicating the server (convention #5); the fallback is dead (the server always sends the string) --> FIXED (9d58beb7a): removed the dead client fallback; the card shows the server string verbatim (single source of truth)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 (the stale docblock was authored by the pre-loop feature commit = BRANCH; the loop's iter2 removal made it stale)
- [WARNING] web/index.html — the communityLine DOCBLOCK still described the removed fallback (a comment asserting behavior the code lacks = convention #5 in prose); the plan line too --> FIXED (d6609bfa0): rewrote the docblock + plan to state what the code does; trimmed the in-function comment
- [CONVENTION] engine/communitystore.js — the shape test covers key derivation but not the null-return branch (the other shared copied logic) --> FIXED (d6609bfa0): added a null-branch assertion pinning both readers null on a .corrupt- sidecar
- [WARNING] server.js — supplied defaults change (dup of iter1) --> DEFERRED (PR note)
- [WARNING] server.js — publishedPostTimesAll adds a per-call read on the status-snapshot path --> DEFERRED: same pattern as the existing 3 per-call reads, gated on the switch; a snapshot-wide cache is a follow-up
- [NIT] "SENT"->"published" wording --> FIXED (d6609bfa0)
- [NIT] setOn reset; esc escaping not exercised (no XSS: fixed server wording); plan filename lacks a timestamp

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 actionable CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** — the one CONVENTION was informational; NITs do not trigger re-iteration.
- [CONVENTION] docs/browser-checks/mobile-shots.js — the new screen is not in CI's strict mobile-shots slice --> DEFERRED: informational, by design (convention #4 satisfied; the render is covered by web.community-card-5314.test.js in CI + the full browser sweep)
- [NIT] raw 86400000 vs the codebase DAY_MS constant (follow-up); inline comm fallback = load-bearing guard (dup iter1); harmless double-concat when sessionName==name (only Math.max used)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | CONVENTION | engine/communitystore.js:548 | BRANCH | duplication needs a shape-pin test (convention #5) | FIXED | 9d58beb7a |
| 2 | 2 | CONVENTION | web/index.html:21245 | BRANCH | dead client-side day-diff duplicates the server (convention #5) | FIXED | 9d58beb7a |
| 3 | 3 | WARNING | web/index.html:21306 | BRANCH | stale docblock describes the removed fallback (convention #5 in prose) | FIXED | d6609bfa0 |
| 4 | 3 | CONVENTION | engine/communitystore.js:558 | BRANCH | null-return branch not shape-pinned | FIXED | d6609bfa0 |
| - | 1-4 | WARNING/CONVENTION/NIT | various | BRANCH | documented non-defects / follow-ups (see per-iteration breakdown) | DEFERRED | reasoning recorded; 3 filed as a follow-up card |

### NITs (non-blocking, across all iterations)
- [NIT] server.js — raw 86400000 where the codebase has a DAY_MS constant (follow-up)
- [NIT] web.community-card-5314.test.js — setOn(true) not reset in test.after
- [NIT] web.community-card-5314.test.js — esc stubbed; escaping not exercised (no XSS: fixed server wording)
- [NIT] server.js — harmless double-concat when sessionName and name lowercase to the same key (only Math.max used)
- [NIT] docs/browser-checks/mobile-shots.js — verify checks viewport bounds, not occlusion (elementFromPoint follow-up)

### Strengths (across all iterations)
- publishedPostTimesAll leaves postTimesAll byte-identical for the community nudge; the held/quarantined exclusion is correct and tested
- The unsupplied-path test exercises the real wiring (switch + store + held-only post), catching a swap back to postTimesAll
- Single source of truth: the server computes the wording, the client renders it verbatim; the DST-safe midnight day-diff handles future-dated posts
- The mobile-shots verify fails loudly when the line is not in the captured viewport (addresses the earlier line-less shots)
- The convention #5 shape-pin tests (key derivation + null branch) genuinely guard the copy-paste duplication

### Deferred follow-ups (filed as a card, not blocking this merge)
- A snapshot-read perf pass (publishedPostTimesAll adds one per-status-poll read; same pattern as the existing 3 reads)
- A withAgentSortFields test for the null-store (communityPosts: null, communityOn: true) hide path
- Use the codebase DAY_MS constant in server.js's day-diff

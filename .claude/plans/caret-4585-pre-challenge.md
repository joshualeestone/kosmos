---
pre_challenge: true
method: challenge-loop
branch: caret-4585
diff_hash: 766e22496c9e332f9e34484e4ae8a378987fd79fe1fed55988c76a32426825ca
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T22:19:14Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes. Iteration 5 (opus) returned no new BLOCKER or WARNING; its three NITs are fixed (8d10a76).
**Total findings:** 22 (0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 16 NITs)
**Fixed:** 21 | **Deferred:** 1 | **Asked (awaiting user):** 0

Focused tests ran after every iteration (the check in Chromium and WebKit, web.*.test.js, the neighbouring
composer checks); the full validation ran once, at convergence (the queue rule, #4574).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] web/index.html pjMentionPaint: the scrollbar subtraction guarded an unreachable state (.cinput hides it in both engines) and could round to 1px --> FIXED, removed; the check asserts the premise (4f33ac5)
- [WARNING] a width change with no window resize left the mirror stale --> FIXED, ResizeObserver; arm PASS with / FAIL without (4f33ac5)
- [NIT] placement by offsetLeft/Top --> FIXED, from the real rect (defensive: whole-pixel offsets at every layout measured) (4f33ac5)
- [NIT] no sideways-alignment arm --> FIXED (4f33ac5)
- [NIT] touch layout not swept --> FIXED, named in the header (render-room-msgbox-2806 guards it) (4f33ac5)
- [NIT] the CSS comment overclaimed --> FIXED (4f33ac5)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] line counts as the sweep's proxy --> DEFERRED: per-character, the first divergent wrap changes the count; glyph widths are held equal by the layout-properties arm
- [NIT] height by offsetHeight --> FIXED (5326fbd)
- [NIT] null offset parent fallback --> FIXED, bails like a hidden box (5326fbd)
- [NIT] redundant repaint --> FIXED at the time with a skip (5326fbd), later removed (iteration 3)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 (the skip from iteration 2)
- [WARNING] the ResizeObserver skip could leave the mirror disengaged after a hide --> FIXED, skip removed (47bdd6a)
- [WARNING] the skip's string compare never matched long fractional widths --> FIXED, same (47bdd6a)
- [NIT] dead sweep parameter, plan wording and count, DM arm as a guard --> FIXED (47bdd6a)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] the new-look arm did not assert the new look applied --> FIXED, it requires the box or the textarea to move (it did: x 370 to 492) (e27366d)
- [NIT] observer comment history, CSS comment, border widths in LAYOUT --> FIXED (e27366d)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged**: no new actionable findings.
- [NIT] word-break comment reason, border in real pixels, the WebKit scrollbar arm's limits --> FIXED (8d10a76)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html pjMentionPaint | BRANCH | scrollbar subtraction | FIXED | 4f33ac5 |
| 2 | 1 | WARNING | web/index.html pjMentionPaint | BRANCH | no repaint on width change | FIXED | 4f33ac5 |
| 3 | 2 | WARNING | render-composer-caret-4585.js | BRANCH | line-count proxy | DEFERRED | per-character sweep |
| 4 | 3 | WARNING | web/index.html observer | SELF | skip leaves mirror off | FIXED | 47bdd6a |
| 5 | 3 | WARNING | web/index.html observer | SELF | string compare | FIXED | 47bdd6a |
| 6 | 4 | WARNING | render-composer-caret-4585.js | BRANCH | new look unasserted | FIXED | e27366d |

Checks: render-composer-caret-4585 29/29 (Chromium, WebKit); 14 of the first 23 arms pass on origin/main (the
wrap sweep reproduces the gap at 1400px and 1180px). Surface-mapped checks run green: room-msgbox-2806 178,
type-to-focus-3283 19, composer-stroke 63, room-reply-3745 66, chatbox-phone-4108 48. web.*.test.js 2160.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
All fixed.

### Strengths (across all iterations)
- The cause was reproduced on main in both engines before any change, and the fix removes it at the source.

### After convergence (stated so the proof does not overclaim)
One change landed after the last blind round and was NOT seen by a reviewer: `browser-checks-reason-grep.test.js`
EXPECTED_SITES 208 -> 210 and EXPECTED_CATCH_SITES 126 -> 127, which count the new check's own emit lines (its
unknown-ENGINES refusal, its PASS/FAIL line and its top-level .catch). Found by the first full validation, measured on
main and on the branch before and after the rebase, not computed. Bookkeeping only; no product code changed. The full
validation above ran on the head that includes it (hash 766e2249).

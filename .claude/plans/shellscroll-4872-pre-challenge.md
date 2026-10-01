---
pre_challenge: true
method: challenge-loop
branch: shellscroll-4872
diff_hash: a36e93f6606686c6fd49c7c0c9a4032b5b84aa6a4eb5219d5f9b30e57ae6ac9f
validation: focused on origin/main e6005adf8: every node test that reads web/index.html (352 files) plus the file-scanning guards and the browser-check registration tests, 3,725 run, 0 failed; render-shell-noscroll-4872 72/72 (Chromium at five sizes, WebKit) after the rebase; render-dm-badges-2863, render-working-pulse-3956, render-agent-lines, render-needsyou-dealarm-2808, render-project-needsyou-2699 pass; both browser-check gates rc 0; a full Mortals run of this head is queued
subdir_audit: passed
timestamp: 2026-10-01T13:03:47Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 22 (0 BLOCKERs, 9 WARNINGs, 0 CONVENTIONs, 13 NITs)
**Fixed:** 13 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - the folded bubble covered the needs-you triangle; the check never built that row --> FIXED (compact folded bubble; the check builds an attn row with the app's LROW_WARN and asserts clearance at "2" and "99+")
- [WARNING] web/index.html - the overscroll diagnosis rested on one built state --> FIXED (a short 1024x640 size added; nothing overflows; the subscription notice is shown in the sandbox, so the notice row is in every run)
- [WARNING] render-shell-noscroll-4872.js - the header claimed the scroll assertion proved the fix --> FIXED (header states what each assertion proves; no-overflow is a regression guard)
- [WARNING] render-shell-noscroll-4872.js - the bounce assertion reads computed style only --> FIXED (stated in the header; the Mac app is the real test)
- [NIT] unasserted `over` list --> FIXED (asserted empty); silent paintRoom guard --> FIXED (posts painted is a precondition); indentation --> accepted

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] web/index.html - knife-edge fit (flush with the strip's top, 0.7px over the triangle) --> FIXED (face 2px lower in the same 42px row, bubble top -3px: about 1px and 1.7px clearance; assertions require it)
- [WARNING] web/index.html - the bounce fix is unverified in the Mac app --> DEFERRED: a stated limit; headless engines do not rubber-band; confirmed by eye in the app with the next build
- [NIT] size count wording (FIXED), "99+" text unasserted (FIXED), :has arm (accepted), dark mode (accepted: the dark .dmbadge rule applies unchanged)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html - the folded bubble covers the top of the memory ring --> DEFERRED as an accepted trade, written in the CSS and the check header (a 48px strip has no free corner; the unread count is the more urgent signal)
- [WARNING] web/index.html - bounce unverified in the app --> duplicate of iteration 2's deferral
- [NIT] comment overstated "nothing overflows" (FIXED), band offset unstated (FIXED), plan wording (FIXED), repaint flake risk (accepted: fails red), dead trailer pair without .js (accepted: noise)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (its one WARNING is the iteration 2 bounce limit again), 0 CONVENTIONs, 3 NITs
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:4881 | BRANCH | bubble over the needs-you triangle | FIXED | 5db7b835b |
| 2 | 1 | WARNING | web/index.html:4510 | BRANCH | overflow claim on one state | FIXED | 5db7b835b |
| 3 | 1 | WARNING | render-shell-noscroll-4872.js:5 | BRANCH | header overstated | FIXED | 5db7b835b |
| 4 | 1 | WARNING | render-shell-noscroll-4872.js:107 | BRANCH | bounce read as style | FIXED (stated) | 5db7b835b |
| 5 | 2 | WARNING | web/index.html:4882 | SELF | knife-edge clearance | FIXED | de6279a7c |
| 6 | 2 | WARNING | web/index.html:4510 | BRANCH | bounce unverified in app | DEFERRED | stated limit |
| 7 | 3 | WARNING | web/index.html:4882 | SELF | bubble over the ring's top | DEFERRED | accepted trade, written down |

### NITs (non-blocking, across all iterations)
- :has arm of the overscroll selector (iterations 2, 4; accepted, :has is used elsewhere in the file)
- temp sandboxes not removed on a throw (iteration 4; same as sibling checks)
- the 2px face shift applies to idle rows too (iteration 4; stated in the CSS)

### Strengths (across all iterations)
- Scope: the bubble rules carry .fold-a and the overscroll rule is consolidated-only inside the 960px block; open rows, org nodes, phones and tab views untouched (iterations 1 to 4)
- The check drives the real board, the real fold button, the app's own dmBadge() and LROW_WARN, at "2" and "99+", in Chromium and WebKit, and states its own limits (iterations 1 to 4)
- Each fix reverted fails the check (measured)

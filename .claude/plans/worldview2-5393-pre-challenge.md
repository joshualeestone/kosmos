---
method: challenge-loop
branch: worldview2-5393
diff_hash: 0b627c797b109d2a617bc6cd878ec17b699987b8ecc61fee50b14e6deeb2f18b
timestamp: 2026-10-08T05:55:00Z
iterations: 8
converged: true
---

# Challenge-loop proof: worldview2-5393 (#5393 slice 2, the page)

"At a glance" in the worlds switcher (#worldsw-glance) opens a sheet (#wv-modal). The sheet reads slice 1's
`GET /api/worlds/overview` and lists every Kosmos on this computer with:
- its tasks nobody is on;
- for the running Kosmos, each provider's state.

Unknown is never shown as zero. Blind reviewers alternated Sonnet and Opus for 8 iterations. Iterations 1 to 7 each
found real gaps, all fixed (one commit per iteration, listed below). Iteration 8 found nothing new, so the loop
converged.

Two commits after convergence came from guards, not review:
- 56eca42ab: web.open-sentence-1199 refuses a ninth inline sentence-dressing copy, so the failed-read reason now uses
  the shared asSentence.
- 731ef400a: the browser-check surface gate needs one trailer per mapped check in the final paragraph.

Validation:
- Gated browser checks: the 8 that map to the touched surfaces ran green before the trailers commit.
- Full validation on HEAD 731ef400a: 16405 pass, 0 fail, validation rc 0, subdir audit rc 0. It passed on attempt 2;
  attempt 1 never ran a test (the queue gave up).

#### Iteration 1
- [WARNING] the sheet drew under floating UI: it sits in the sticky .apphead's stacking context. FIXED 9dcdd4910:
  the header takes z-index 50 while the sheet is open. The browser check probes elementFromPoint, and fails without
  the rule.
- [WARNING] "on another computer" was false for a Windows agent on this computer. FIXED 9dcdd4910 (true words).
- [NIT] a pause ending on another day names the day; held-only wording; focusable, labelled list. FIXED 9dcdd4910.

#### Iteration 2
- [WARNING] the focus trap skipped the scrollable list. FIXED 67b5ebdd3.
- [WARNING] the browser check's "two hours ahead" fixture failed after 22:00 on correct code. FIXED 67b5ebdd3.
- [NIT] a pause six or more days away names the date; any-word weekday match; a consolidated-layout arm. FIXED
  67b5ebdd3.

#### Iteration 3
- [WARNING] a failed Refresh was silent. FIXED 52f3d851f (#wv-status, role=status).
- [NIT] an empty answer said nothing; the "no AI provider shown here" count included cards reporting no runner; the
  modal-way-out entry now anchors on wvClose. FIXED 52f3d851f.

#### Iteration 4
- [WARNING] the browser check was not wired: gated.txt and SITE_COUNTS [4, 2] were missing, and both guards were red.
  FIXED b21a96065.
- [WARNING] a signed-out board suggested Refresh. FIXED b21a96065 (says to sign in; arm added).
- [NIT] the status is cleared per read; a non-list 200 announces the failure; README wording. FIXED b21a96065.

#### Iteration 5
- [CONVENTION] aria-label on a div with no role. FIXED 421ea4382 (role=group).

#### Iteration 6
- [NIT] a server reason read as a fragment. FIXED af6df9042.

#### Iteration 7
- [WARNING] "Your Kosmoses are up to date" claimed freshness the page cannot know. FIXED d1ead572d ("Read just
  now."). The plan records the 403 wording and past pause times as decided limits.

#### Iteration 8
- No new issues found.

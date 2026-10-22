---
method: challenge-loop
branch: appchrome-6846
diff_hash: 304699a0ed08d8f1146981f5faee408ca522df17cc284822e9227a9264eef51d
timestamp: 2026-10-21T19:17:15Z
subdir_audit: passed
iterations: 4
converged: true
---

# Challenge-loop proof: appchrome-6846 (kosmos#6846 part c, the board's header inside the iPhone app)

Stacked on apptab-6846 (part a, #6848); the hash covers origin/main...HEAD, so it includes part a.
When the iPhone app adds html.kapptabs, the board's navy bar becomes the app's own 44px header: the computer
switcher on the left (two or more computers only, Josh #6396) and the person's face on the right, both opening
the phone menu at their level. Four blind iterations, alternating Opus and Sonnet; each iteration's fixes are in
its commit message.

#### Iteration 1 (Opus): four warnings, all FIXED (15cb95c)
- Focus after a tab or section chosen from the app header's menu now returns to its opener.
- The menu opens straight at its level instead of animating through the first level.
- mobile-shots: app screens need --app-tabs; nav-menu is skipped under it.
- render-apptabs waits for the computers answer to be taken in; new arms M3, M4.

#### Iteration 2 (Sonnet): one warning, coverage, nits, all FIXED (a3131de)
- Back lands on the items that lead to each level; the face is named for what it opens; new arms S3, S3b, S5, M5.

#### Iteration 3 (Opus): one warning, one convention, nits, all FIXED (9f5ba94)
- An M4 control (the watcher can see the first level); typeof guards where tests lift functions alone; a 44px
  minimum for a short name; the bar named Kosmos in the app.

#### Iteration 4 (Sonnet): no blocker, warning or convention finding. Nits, NOT FIXED:
- no Escape arm after kappOpenAt; no wide-viewport browser control with kapptabs; the bar's aria-label is set only
  on paint; face equality compares re-serialized innerHTML (could repaint a picture whose URL has &).

#### After convergence (test harness only, not re-reviewed)
- d386928: the first browser run showed Playwright's init script running before <html> existed, so the class
  never landed (every app arm red, all shots errored). Both harnesses now add the class once <html> exists.
  No product file changed. 0aeaacc: an empty commit carrying the surface-gate reasons.

#### Evidence
- render-apptabs-6846: every arm PASS in Chromium and WebKit, light and dark, incl. controls C1, C2, M4 CONTROL.
- render-plus-bar-3837, render-mobilenav-4823, render-user-menu-3051 (78 passed): PASS at 9f5ba94; web/index.html
  unchanged since.
- Browser-check gates: coarse #1720 rc 0, surface #2518 rc 0 (per-check trailers on 0aeaacc).
- Design shots: 6 taken, 0 errors, looked at (~/work/design-shots/kosmos-6846/), sent to Mona Lisa on #6846.
- Focused node run 3332/3332 at 9f5ba94.

#### Rebase 2026-10-22 03:3xZ
- Rebased onto main (part a stays in this PR; #6848 is closed in its favour). The diff changed only in hunk line numbers (checked hunk by hunk); no content change, so no new review round.

#### Rebase 2026-10-22 01:2x CDT
- Onto main with #6885 (render-avatar-4038 made current for the crop editor). Diff unchanged apart from hunk headers and index lines (compared with those stripped). render-avatar-4038 failed on main 8f6037e as on this branch (pre-existing, #6722/#6885); render-snav-head-4979 passed locally on main 8f6037e and on this branch b0cf2bb, red only on CI (tracked in #6861).

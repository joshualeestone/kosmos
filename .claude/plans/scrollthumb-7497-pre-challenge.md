---
pre_challenge: true
method: challenge-loop
branch: scrollthumb-7497
diff_hash: 8edeb19e583c6f3519747d2c1c51e0c3198b95c3edaa942fd30550ba8cc988e0
validation: policy tests green; browser-checks-selectors 4/4; browser-check gate green; CI browser-checks: new arm passed (36 / 16); thumb probe in real WebView2: 36 / 13
subdir_audit: passed
timestamp: 2026-10-28T17:31:10Z
iterations: 1
converged: true
---

# Pre-PR review proof: scrollthumb-7497

**Iterations:** 1
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/scrollthumb-7497.md

## Rounds

#### Iteration 1
- Round 1: no blocker, no warning; 4 nits fixed: the comment's "about 8" corrected to the measured 13
  (control bound loosened to < 25), the short-pane edge measured in WebView2 (30px pane: thumb fills
  the track, 26 rows; it does not vanish), one consistent before-measure (17 lit rows), and a 1x600
  size assertion in the decoder.

### Final Ledger
# #7497 challenge ledger

## Round 1 (blind review): no BLOCKER, no WARNING, 4 NITs, all fixed
1. The comment said the unfloored thumb is "about 8"; the measured value is 13 (Chromium's own minimum). The comment was corrected and the control bound loosened from < 20 to < 25. FIXED.
2. The plan claimed short panes "leave room"; the reviewer recalled Chromium dropping the thumb when it exceeds the track. Measured in WebView2: a 30px pane shows a 26-row thumb (it fills the track), and 45px and 60px panes show 36. Recorded in the plan and the CSS comment. FIXED (measured, no code change needed).
3. The before-measure was inconsistent ("about 10px" vs "17 lit rows"). Both places now say 17 lit rows. FIXED.
4. The decoder hard-coded 600 rows with no size check. It now asserts a 1x600 screenshot. FIXED.

## Box evidence
- Real Kosmos window (WebView2, 0.7.72), 46,321px thread in a 599px pane: 17 lit rows before, 40 after (dark).
- The browser check's probe over CDP in the same WebView2: 36 with the floor, 13 without (600px pane, light).

## CI
- First CI run: browser-checks PASSED the new arm (36 rows with the floor, 16 without, on CI Linux Chromium). The node suite failed browser-checks-selectors.test.js (#758): the probe was looked up by an id the page does not have. Fixed by holding a reference instead (fails 3/4 before, 4/4 after).

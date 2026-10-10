# menufooter-5749: Claude's question menu reads needs-you whatever its highlight is on (kosmos#5749)

## Why
The board's card says an agent needs the person only when it sees a numbered highlighted row in the screen's last 25 rows. Two real menu screens have none in reach: the multi-select form with its highlight on the unnumbered Submit row, and a menu tall enough that the highlighted row is above those rows. The card then read "can't tell", so the hold that stops typed lines landing in a menu (#5743) never looked, and a pasted line's Enter submitted choices nobody made. Separately, the review tab draws no footer, so the menu reader (`claudeQuestionMenuUp`) missed it.

## The change
- `engine/status.js` `classify`: after the numbered-row rule, `claudeQuestionMenuUp` on the whole screen (bottom-anchored: footer plus the free-answer row) also reads needs-you.
- `claudeQuestionMenuUp`: also true for the review tab ("Ready to submit your answers?" and a "Submit answers" row among the last four non-blank lines).
- Two real captures (Claude Code 2.1.296) added to test-support/claude-screens; `engine/status.menufooter-5749.test.js`.

## Measured
On main before the change: the Submit-highlighted capture classified `unknown`; the review tab was needs-you (it has a `❯ 1.` row) but `claudeQuestionMenuUp` was false. After: both needs-you and both read as the menu; a permission prompt is still not the menu. The review tab's BOARD state is unchanged (its `❯ 1.` row already made it needs-you); what is new for it is the menu reading the chat hold uses.
- Review 1: the classify rule sits above the working checks on purpose (a menu blocks while the title still spins), pinned by a test; the review rule also needs the form's title, so its two lines in agent prose do not count. The safeguards menu is out of scope (it has its own rule).
- Review 2: my review-1 title check used a fixed 20-row window, which a padded capture or a long list of answers defeated (a live review tab then read "unknown"). It now searches upward within the form, stopping at its tab header or a rule line; tests for both.

## Gaps, stated
- A menu taller than 25 rows was not captured; it is covered by the same footer rule, reasoned, not measured.

## Weakest premise
That the review tab's two lines stay worded as captured; a reworded Claude Code would miss it again, as any screen reader here would.

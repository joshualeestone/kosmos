# stuckscrolled-6717: the stuck-input sweep presses the board's own long line in a resized pane

Card: kosmos#6717 (claimed:angel 11-02, after Sonya Blade released it). Evidence: #7784 item 1, Josh's 0.7.83 report.

## Finished looks like
An idle Claude Code agent whose box holds Kosmos's own long line (scrolled, so only its end shows) is no longer deaf
when the pane was resized after the line was left: the minute sweep presses it, posts held behind it then flow. A
person's text, or our line with words added after it, is still never pressed.

## Cause (read on main 10ce35b960)
- A long delivery whose Enter does not take is remembered with `seen`, the end the box showed then.
- The sweep (recoverStuckInput) asked `rememberedShows(..., exact=true)`: `seen` must match exactly. A resized pane
  wraps the same end to another length, so it does not, and the box (7 rows, > STUCK_ROWS_MAX) is `left` as too long.
- The wider end rule (any end of our line >= SCROLLED_MIN, rows >= SCROLLED_ROWS) was "left to a delivery", but no
  delivery comes: posts are held while the box holds text (#6256). Deadlock; logged once, then silent.

## Change
- `pressRememberedNow(target, card, wide = false)`: `wide` decides with `rememberedShows(text, kept, !wide, rows)`.
- recoverStuckInput recognises our line with the wide rule and calls `pressRememberedNow(..., true)`.
- #6436 retries are unchanged (exact).

## Rejected
- Raising STUCK_ROWS_MAX / drafting a partial box: the hidden start would be lost when cleared.
- Remembering every delivery (not only unsent ones): larger change; the report's case is a remembered line.

## Weakest premise
The wide rule cannot see rows above the visible end: a person who moved the cursor up and typed there would be sent
with our line. A delivery already accepts this; the sweep adds 10 minutes idle and the same gates before the Enter.
Not covered: a delivery that believed it was placed (no memory) and sits unsent; that stays `left` and said once.

## Tests
engine/chat.stuckinput-6717.test.js: resized long line pressed by the sweep; our line plus a person's words left.
Mutants: sweep not wide in either place -> the new test fails (waiting/changed; left/too long).

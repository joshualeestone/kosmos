# feedbackdate-8353: an impossible date is a bad date

Card: kosmos#8353. Measured first: the card's main ask (no report yet = exit 0 with a sentence) is already met on both
CLIs since #8260 (0.8.00, which prod serves on Mac and Windows). Its second ask, a non-zero exit for a bad date, is only
half met: engine/feedback.isDateKey checked the YYYY-MM-DD shape only, so `kosmos feedback show 2026-13-45` exited 0 with
"No product-feedback report for 2026-13-45 yet."

## Change
- engine/feedback.isDateKey: the shape AND a real calendar day (a UTC round trip). Every caller already treats false as
  an input error (CLI exit 2, server 400, triage refusal), so impossible dates become that error.
- Both CLIs' refusal now reads "that date must be a real day, as YYYY-MM-DD".

## Tests
engine/feedback.test.js (1), cli.feedback-2037.test.js (1, with a leap-day control), tools.windows-kosmos-cli-570.test.js
(the stub now uses the real isDateKey; 1 assertion). 28 related files green. 6 mutation arms: 4 red; no-day-check and
no-month-check survive as equivalent mutants (an out-of-range day rolls the month and the day both, so either check alone
rejects every impossible date).

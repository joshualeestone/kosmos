# kosmos#966 -- a benign Fable 5 promo banner false-pauses a healthy agent as rate_limited

## Source

Live bug report from Josh, Discord (`1537823357720985811`), 2026-08-26, with 4 screenshots.
His fresh Mac Mini's very first agent (Casey), healthy account, zero real usage, showed "Paused
- usage limit" the moment Claude Code's own new startup banner appeared:

```
Fable 5 is now a standard part of your Max plan
You can use up to 50% of your weekly usage limit on Fable 5. If you hit your limit, you can
continue on Fable 5 with usage credits...
```

Confirmed via direct screenshot download + read (not guessed from his description).

## Verified before writing any code

- `engine/status.js`'s `RATE_LIMIT_MARKERS` (lines ~1214-1221) contained a bare `/usage limit/i`
  entry, which matches the promo sentence "your weekly usage limit" as readily as a genuine
  block message.
- Read `engine/status.test.js`'s three tests that exercise this array (lines 351-354, 2780-2793,
  2407-2439) and confirmed none of them depends on the bare marker:
  - The "usage limit outranks everything else" test's fixture text also independently matches
    `/try again (later|at)/i`.
  - The `#886` scraped-rate_limited test constructs the state directly via `scr(STATE.RATE_LIMITED,
    ...)`, bypassing `classify()`'s regex matching entirely.
  - The real 2026-08-21 regression test's fixture text matches BOTH `/reached your .{0,40}limit/i`
    and `/\/usage-credits\b/` independently, neither of which is the marker being removed.
- Confirmed the promo banner text does NOT match either of those two narrower markers either
  (no "reached your ... limit" phrasing; says "usage credits" in prose, not the literal
  "/usage-credits" command), so removing the bare marker is the minimal fix for this exact
  string, verified against both directions before writing any code.

## Fix

`engine/status.js`: remove the bare `/usage limit/i` entry from `RATE_LIMIT_MARKERS`, leaving
`rate limit`, `429`, `try again (later|at)`, `reached your ... limit`, and `/usage-credits`.
Added a comment in the file's own established citation style (matching the existing
"observed 2026-08-21" precedent) documenting today's incident, why it is safe (the two other
2026-08-21 markers do not depend on the removed one and the promo banner matches neither of
them), and framing it as the mirror image of the prior miss: that one was too narrow to catch a
real block, this one was too broad to rule out a non-block.

## Explicitly not changed (scoped out, tracked separately)

This branch fixes ONLY the one string collision. The larger design question -- that
`classify()` treats ambiguous pane text as a confident verdict rather than degrading to
"cannot tell" -- is tracked in kosmos#966 (opened alongside this branch) for follow-up:
structured-signal detection, precedence/confidence gating before the rate-limit branch, or a
positive exclusion on the promo banner's own support-article link. None of that is implemented
here. kosmos#967 (Terminal tab has no input box) was also opened, unrelated code, tracked
separately.

## Test plan

`engine/status.test.js`: new test `kosmos#966: the Fable 5 promo banner does not read as a
spent limit`, using the verbatim captured banner text, asserting `classify()` no longer returns
`rate_limited` for it, with a control in the same test that the real 2026-08-21 block message
(from the neighboring existing test) still classifies as `rate_limited` -- proving the fix did
not also blind the markers it shares the array with.

Full suite: `bash tools/run-tests.sh`, 2198/2198 passing, including the pre-existing three tests
that exercise this array.

## Challenge-loop

Standard `/challenge-loop` to convergence before `/create-pr`, per house process.

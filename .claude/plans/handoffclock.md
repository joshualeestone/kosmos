# handoffclock: the #6506 render test failed once its fixed date passed

## Finished looks like
`engine/handoff.test.js` passes on any day, and `suite (node)` on main stops failing on it.

## Cause (measured 2026-10-19 16:35 CDT)
The render test passes `now: 2026-10-18T20:00Z` and writes an instruction file whose mtime is
the real clock. `saneIso` rejects a time more than a day after `now`, so from 2026-10-19 20:00Z
the file's mtime reads as untrustworthy, the line says "cannot tell when it last changed", and
the test's `/last changed /` match fails. Reproduced on a clean checkout of origin/main
(ba94839879); no code change involved.

## Change
That one test passes `now: Date.now()`. Its other assertions do not depend on the date; the
`saneIso` unit test keeps its fixed clock, since it builds its own times from `now`.

## Verification
`node --test engine/handoff.test.js`: 22 of 22 pass (was 21 of 22 on main).

# dstslots-7716: the #5920 recovered-run tests step hourly slots as the rule does

Addresses #7716.

## Finished means
1. `engine/tasks.recovered-5920.test.js` passes in America/Chicago while its slots cross the Nov 1 fall-back, where
   main's copy fails 2.
2. It still passes under TZ=UTC (CI's zone) and in America/New_York.
3. PR open, CI green by name, reviewed.

## Change
A `slotAfter(ms, k)` helper steps k slots with `taskrepeat.nextAfter(HOURLY, ...)`, and every `+ k * 3600000` in the
file uses it. Test only. Line 147's `lastRunAt + 3h30m` becomes `slotAfter(lastRunAt, 4)`: lastRunAt sits 30 minutes
past a slot, so the old sum landed exactly on the fourth slot after it, and the new form names that slot.

## Measured (2026-10-31 22:26 CDT, inside the window)
- fix: Chicago 10/10, UTC 10/10, New York 10/10;
- CONTROL, main's file in the same Chicago run: 8 pass, 2 fail (1 !== 2).
A run outside the window proves nothing either way (both copies pass).

## Not done, and why
- No faked clock: `freshHourly` sets the rule through `tasks.setRepeat`, which stamps the real time, so the tests can
  only cross a change when the clock does. A clock seam in tasks.js would be a product change for a test-only defect.
- Other files: PR #7355 (card #7281) fixed `tasks.repeat-4787.test.js`; this card is the one that went red tonight.
- Half-hour shifts (Australia/Lord_Howe): `nextAfter` keeps the spring change's missing 02:00 hourly slot as 02:30, so
  the slot after it is 30 minutes away and the fixed `+ 30 * 60000` after the third slot can land on it (a reviewer's
  simulation: 9 of 412 start times there, against 60 on main's form; 0 in US, European, Santiago and Havana zones).
  Next possible in October 2027 and never in UTC CI; the off-grid slot is the product's choice for hourly rules.
- The tests take their expected `from`/`to` from `nextAfter` too, so a wrong `nextAfter` would agree with itself here;
  stepping is covered by the taskrepeat tests, and these cover `recordRun`.

## Weakest part
The proof depends on tonight's window; after 02:00 CDT nobody can re-measure it until March without a clock seam.

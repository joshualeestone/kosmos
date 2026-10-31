# undoclock-5153: the undo test plans on its fixtures' day (#7671)

## Finished means

1. `engine/undo-5153.test.js` passes whatever today's date is.
2. No other test that uses undo reads the real clock against fixed fixture dates.
3. No product code changes.

## Cause

The fixtures are dated 1 October 2026 (`T = (hhmm) => '2026-10-01T...'`). Eighteen `undo.plan(project, task)` calls
passed no `now`, so `engine/undo.js` `plan()` used `Date.now()`. From 31 October 10:00 UTC a hold's first copy is
older than `KEEP_DAYS` (30), and `plan()` flags it `incomplete` (`hold0 < now - KEEP_DAYS * 86400000`). The first
test then reads `restore false`. The file's `apply()` calls already passed `{ now: ms('12:00') }`.

## Change

- `engine/undo-5153.test.js`: a `NOW = ms('12:00')` constant beside `ms`, passed to all 18 `plan()` calls and to all
  14 `apply()` calls (the one `apply()` that returns `off` before planning included).
- `engine/undo-credential-4491.test.js`: the same 1 October fixtures and four unpinned `plan()` calls (review 1). It
  still passed only because `protected` and `cannot-check` are flagged before `incomplete`; its two CONTROL rows accept
  `ok || incomplete`, so since 31 October they could no longer see the `ok` half. The four calls take `{ now: NOW }`.
- A new test pins the age boundary on purpose (review 1): the same hold planned at `NOW` and at exactly `KEEP_DAYS`
  after its first copy is whole, and one millisecond later is `incomplete`. Before this, only the calendar exercised
  that branch.

## Checked

- Red alone at origin/main 3d4938ee01, three of three; green before 10:00 UTC on unchanged code.
- After the change: the two files 31/31; the five undo test files pass.
- Control: removing the `KEEP_DAYS` age check from `plan()` turns the new boundary test red by assertion.

## Rejected

- Moving the fixture dates to "now minus a day": the dates are compared by exact string in several assertions
  (`T('11:00')`), and a moving date reintroduces the same class at another boundary.
- Raising `KEEP_DAYS` or changing `plan()`: the product is right; only the test asked about the wrong day.

## Weakest point

Another test elsewhere could read undo's real clock through a route (a server test). The full suite at 05:44 CDT
showed this one test red and no other, which is the evidence it is alone today; a fixture dated later could still
expire later.

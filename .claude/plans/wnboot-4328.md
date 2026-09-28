# wnboot-4328: What's New waits for the boot cover to lift

Addresses #4328 (claimed:raiden, Liu Kang m2362). Found by Renet while building #4288 part B.

## Finished when
- What's New never opens, and never records the version as seen, while `#boot-cover` is visible.
- It opens right after the cover lifts.
- Pinned by a check that goes red on main, with a control showing it still opens once the cover is gone.

## Cause (read from the code)
- `whatsNewCheck()` fetches `/api/whats-new` at load and waits only while `held()`: `TIP_OPEN || wnCovered()`.
  `wnCovered()` is `.fr-back:not([hidden]), .upd-back`. The boot cover is in neither.
- The boot cover is lifted by `firstRunBoot`'s `finally` or by the 3 s fallback timer at the boot call, whichever
  is first. `/api/whats-new` usually answers well inside that, so the window opens, and records the version as
  seen, before anyone can see it.
- The card says the cover "stays up until first run's check answers" (up to about 35 s). The 3 s fallback bounds
  the cover itself to about 3 s. The defect is real inside that window; its length is not 35 s.

## Change
- `held()` also waits while `#boot-cover:not([hidden])` matches. It is in `held()`, not `wnCovered()`, per the
  card: `wnCovered()` also decides who owns Escape, Tab and focus, and the cover takes no keys.
- The clause is guarded on `typeof document`, like the other two on `TIP_OPEN` and `wnCovered`. The unit tests lift
  `whatsNewCheck` alone, and an unguarded `document` would throw inside its `try` and silently open nothing.

## Pins
- `web.whatsnew-3955.test.js` has two lifted-function tests with a fake document.
  - With the cover up, nothing opens and nothing is recorded; after it lifts, one open and one record.
  - Control: no cover, and it opens and records at once.
  - Measured: the cover test FAILS against main's page ("the window opened under the boot cover"), and the
    control passes on both.
- `docs/browser-checks/render-boot-no-flash.js` (the check the surface gate maps to `boot-cover`) gains arms C and D.
  - Arm C holds `/api/first-run`, with `/api/whats-new` answering a newer version at once. It looks 700 ms after
    `/api/whats-new` is answered (review iteration 1: the 3 s fallback starts before domcontentloaded, so a fixed
    2 s wait from load left under a second of margin). The cover must be up with no window and no seen POST; after
    the cover lifts, one of each.
  - Arm D is the control, with no hold.
  - The seen POST is answered in the page and never reaches the shared board, and tips are switched off so the
    tour cannot be what holds the window.
  - Measured with sandboxed boards run by hand, since `tools/browser-checks.sh` boots every fixture board:
    - the fix passes all four arms;
    - main FAILS arm C twice (opened under the cover; recorded as seen while the cover was up), and passes
      A, B and D.

## Weakest part
- Arm C races the 3 s fallback in both directions.
  - If the page is slow to fetch `/api/whats-new`, main could pass the arm by accident. It now reads 700 ms after
    the answer, which bounds this.
  - If the fallback lifts the cover before the read, correct code fails with "the cover was already down when the
    arm looked". That is a loud false red, never a false green.
  - The unit test does not depend on timing.
- Not covered by this fix, and unreachable today (review iteration 1): first-run answering not-done after the 3 s
  fallback would lift the cover, let What's New open, then paint the first-run overlay over it. A fresh install
  has no `seen` and returns before any window, so that path does not occur now.

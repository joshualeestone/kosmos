# update-abort-notice-2055 -- the board notice for a silently-aborting update (#2055)

## Why
An update that cannot pause the board aborts, forever, and tells nobody: 155 aborts on one
machine, visible only in install.log. A machine in this state stops receiving fixes -
including the fix for whatever else is wrong - and neither the user nor we can tell. Angel's
engine half (PR #2062) records a durable, consecutive-counted marker and exposes it as
`/api/status -> updateAbort = { count, reason, port, ts } | null`. This is the board notice
that reads it: the follow-up half, routed to me because it needs a browser check.

## What (frontend only; independent of #2062's merge)
- A `#uabort-slot` in the board's notice stack (its own slot, hidden while `:empty`), and
  `paintUpdateAbort(ab)` called from tick()'s SUCCESS path.
- Renders ONLY when `ab` is a present object with a finite count >= 1. null / absent /
  count 0 / a garbage count all clear it. `Number.isFinite` refuses NaN/strings so a corrupt
  count never paints "failed NaN times".
- Reads `data.updateAbort` off the same /api/status tick already handles, so it merges
  independently of #2062: a healthy or older board returns no field -> null -> no notice.

## The three states (Mona Lisa's spec + the position-not-presence discipline)
- {count} -> the notice, naming N.
- null -> NOTHING, and NOT "up to date": null only means it got past the pause; general
  update success/failure is `updateAttempt`, a different signal.
- absent / unreadable -> NOTHING. Because the painter is called only from tick()'s success
  path, a failed read is the board's own not-signed-in / cannot-read screen (#2023), never a
  false "healthy". For a STATUS signal absence is honest; the lie this class guards is a
  definite POSITION shown without a confirmed read (#2047 / #2023), which cannot happen here.

## Copy (Mona Lisa, #2055) and the action, which is NOT a button
- Title "A new version of Kosmos is ready"; body "This computer has tried to install it N
  times and could not, because Kosmos was busy each time"; sub "Quit and reopen Kosmos:
  reopening usually clears whatever was holding the update, so the next one can finish. Your
  agents keep working, they do not live in this window." Quiet notice, not a modal (#1923).
- The action is a plain INSTRUCTION, not a control, and that was MEASURED, not assumed:
  - "Update now" would re-enter setup.sh's pause block (server.js /api/update -> update.js
    curls installkosmos.com/setup = setup.sh; the block is gated on FRESH_INSTALL, not
    auto/manual) and abort identically on a stuck installed machine -> a dead button.
  - A "Quit and reopen" BUTTON is not buildable from web: the board serves the page, so a
    button that quits it kills its own tab, and the stuck board is unsupervised (no launchd
    relaunch) so nothing brings it back. A native-app self-relaunch could exist but is out of
    scope for a web notice.
  Both are the day's recurring dead-affordance class (a control a degraded state cannot
  honour); "usually" hedges the case a quit cannot fix (a blocking board on a DIFFERENT macOS
  account, #2051, flagged not promised).

## Verification
- web.update-abort-2055.test.js 4/4 (lifts the real paintUpdateAbort: count -> notice + N,
  once vs plural, null/absent/0/garbage all clear, and count -> null recovery clears a stale
  notice).
- docs/browser-checks/render-update-abort-2055.js: injects updateAbort into the REAL
  /api/status 200 so tick's real success path runs; 8/8 including the card's required
  dangerous-answer control (a CLEAN board shows nothing) plus null and garbage controls.
- Browser-check wiring reconciled: README indexed, run_one on $P11, reason-grep
  EXPECTED_SITES 32 -> 33, selectors (#uabort-slot exists in web/index.html). Guards 18/18.
- No em dashes in the added lines.

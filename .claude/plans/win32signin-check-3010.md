# Plan: re-add the start-at-sign-in browser check, HTTP-served (#3010)

## What finished looks like

`docs/browser-checks/render-win32-start-at-sign-in.js` exists again, passes in chromium AND
webkit, is wired into the harness, and does NOT time out (the failure that removed the first
one). The rendered-and-clicked switch has a browser check, alongside the DOM-level
`web.win32-start-at-sign-in.test.js`.

## The dependency (measured first)

The `data-start-at-sign-in` switch and its DOM test are NOT on origin/main -- they live only on
PR #3008 (`win32-installer-native`, OPEN, tmnt-windows). So this check cannot be built or run
against main (the element is absent); it must land on #3008's branch, where the switch exists.
This branch is off `origin/win32-installer-native` and the PR bases into it.

## The call

The removed check was HERMETIC (loaded `web/index.html` over `file://`, stubbed fetches via
`addInitScript`). In CI, `page.click` on the switch timed out on a `file://` hit-test/actionability
check; two prior attempts (un-hiding ancestors; opening the Settings view the app's way) did not
fix it, so it was removed and carded here.

Measured empirically: the same click fixes clean over **http** (~63ms, the switch's own knob at the
click point, `elementFromPoint` returns the switch -- nothing covering). So the fix is the card's
first suggestion: serve over HTTP. The check now runs against the served board (`KOSMOS_URL`) and
`page.route`-mocks ONLY `/api/machine`, `/api/machine/start-at-sign-in` and `/api/first-run` to a
win32 state (the `render-token-usage-2617` pattern), letting every other request hit the real board.
The switch's runtime state comes from the mocked `/api/machine`, its platform from the page's own
`kosmos-platform` meta + `applyPlatformCopy`, exactly as a win32 board renders it.

## What I rejected

- **Keeping it hermetic (file://) and forcing the click** (`{ force: true }` / `dispatchEvent`):
  rejected. Forcing past an actionability timeout masks a real problem, and the empirical result
  shows the click is genuinely fine over http -- so there is no problem to force past, and the
  honest fix is to remove the file:// cause rather than paper over it.
- **Building against main**: impossible -- the switch is not on main (see the dependency above).

## Weakest premise

The check runs against the served board's macOS layout with the platform overridden to win32
in-page (meta + `applyPlatformCopy`), the same override the removed check used. It is NOT a real
Windows board. That is the deliberate boundary of a browser check (the pixel/native truth is the
Windows box's own run); this pins that the switch renders, clicks, and repaints from the engine's
read-back on any board, which is what a source test cannot see. If the win32 render diverged in a
way only a real Windows layout shows, this would not catch it -- but neither would any check that
runs on the Mac CI board, and that is out of scope for #3010.

## Verification

- Standalone against a booted board: 32/32 assertions, chromium + webkit (all 7 arms).
- Registration: browser-checks-reason-grep (count bumps SITES 106->107, CATCH 75->76, documented),
  browser-checks-indexed (README row), tools.browser-checks-wired, bc-surface-map -- all green.
- web.win32-start-at-sign-in.test.js (DOM) still green; its comment restored to reference the check.
- Full harness run (wired on $B8) confirms it in context.

## Delivery

PR bases into `win32-installer-native` (#3008), so the check merges with the switch it asserts.
Tag the win32 owner (tmnt-windows) -- it is their PR; I solved the browser-check they deferred here.

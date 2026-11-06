# signinwatchrow-7504: Windows Settings says when crash recovery was not set up (#7504)

## Problem
Turning on "Start Kosmos when I sign in to Windows" also registers the crash-recovery watchdog (#7498, #2988).
POST /api/machine/start-at-sign-in answers `watchdog: { ok: false, because }` when that fails, but
web/index.html's startAtSignInClick (through machineSwitchClick) read only `on` and `error`, so the switch showed on
and nobody learned recovery was missing.

## Change
- machineSwitchClick takes an optional `afterOk(out)`: on a successful answer, its words go in the existing message
  line under the machine rows (#set-machine-msg), the same place a refusal is said. Keep-awake passes none.
- startAtSignInRecoverySaid(out): says nothing unless `out.watchdog.ok === false`; then the Windows copy
  startAtSignInNoRecovery plus the engine's own reason (or "Windows did not say why"), with exactly one full stop.
- Shown as text (textContent), never markup.

## Decided
- The message line, not the row's hint: the rows are repainted from /api/machine after every click, which would wipe
  anything drawn inside them; the line under them survives, and is where refusals already go.
- Built from the Mac: page work in web/index.html, not the Windows client app (premise on the card).

## Tests
- web.win32-start-at-sign-in.test.js: failed with reason; no or blank reason; punctuation (one full stop, a
  bracket after a full stop kept); CONTROLS registered, present, no field, null; refusal wins; keep-awake unaffected.
- docs/browser-checks/render-signin-recovery-7504.js: Chromium and WebKit, desktop and phone, failed vs three
  controls, markup as text, no sideways scroll.
- mobile-shots screen settings-signin-recovery-7504 for design review.

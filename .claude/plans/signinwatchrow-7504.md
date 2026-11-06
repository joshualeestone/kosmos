# signinwatchrow-7504: Windows Settings says when crash recovery was not set up (#7504)

## Problem
Turning on "Start Kosmos when I sign in to Windows" also registers the crash-recovery watchdog (#7498, #2988).
POST /api/machine/start-at-sign-in answers `watchdog: { ok: false, because }` when that fails, but
web/index.html's startAtSignInClick (through machineSwitchClick) read only `on` and `error`, so the switch showed on
and nobody learned recovery was missing.

## Change (first design, SUPERSEDED: see "After design review" below)
- machineSwitchClick takes an optional `afterOk(out)`: on a successful answer, its words go in the existing message
  line under the machine rows (#set-machine-msg), the same place a refusal is said. Keep-awake passes none.
- startAtSignInRecoverySaid(out): says nothing unless `out.watchdog.ok === false`; then the Windows copy
  startAtSignInNoRecovery plus the engine's own reason (or "Windows did not say why"), with exactly one full stop.
- Shown as text (textContent), never markup.

## Decided
- The message line, not the row's hint: the rows are repainted from /api/machine after every click, which would wipe
  anything drawn inside them; the line under them survives, and is where refusals already go.
- Built from the Mac: page work in web/index.html, not the Windows client app (premise on the card).

## Tests (first design, SUPERSEDED: see "After design review" below)
- web.win32-start-at-sign-in.test.js: failed with reason; no or blank reason; punctuation (one full stop, a
  bracket after a full stop kept); CONTROLS registered, present, no field, null; refusal wins; keep-awake unaffected.
- docs/browser-checks/render-signin-recovery-7504.js: Chromium and WebKit, desktop and phone, failed vs three
  controls, markup as text, no sideways scroll.
- mobile-shots screen settings-signin-recovery-7504 for design review.

## After design review (Mona Lisa, 11-05 20:49): the page owns the words
- engine/win32board.js: ensureWatchdog's failures carry `kind` (refused | not-yet | no-time | other); a /Create
  Windows refused also carries `detail`, Windows' own first line without "ERROR:". `because` is unchanged for every
  other reader (logs, the boot path's withWatchdog builds its own answer and is untouched). CRLF output split fixed.
- web/index.html: startAtSignInRecoverySaid picks the page's own sentence by kind and never shows `because`:
  refused (with Windows' words, then the way out), not-yet (fixes itself, no way out), no-time ("yet", way out),
  anything else or no kind (first sentence, way out). "Turn the switch off and on to try again" is offered only where
  turning it on runs ensureWatchdog again.
- Superseded: the "engine's own reason after the colon" design above, and its one-full-stop rule.
- Not taken: a "One thing is not set up:" lead (not-yet is not a failure).

## Review round 2 (opus, whole branch)
- BLOCKER fixed: on Windows schtasks writes its refusal to stderr, and win32board.run's `out` falls back to Node's
  "Command failed: schtasks.exe ... C:\\Users\\<name>\\..." message, so the first line of `out` would have reached the
  page with the person's folder in it. run() now also returns `stderr` and `timedOut` (out unchanged for its readers);
  installWatchdog takes the detail only from an ERROR: line (stderr, then out), drops it if it names a path, a
  command or schtasks, and calls a timeout no-time and anything without an ERROR: line other. Tests drive those
  shapes (refusal on stderr, refusal inside Node's message, an ERROR: line with a path, timeout, missing schtasks).
- WARNING fixed: "will not reopen on its own if it closes yet" read as "closes yet": now "on its own yet if it closes".
- NITs taken: installWatchdog's doc names kind/detail; the shots entry moved above the keep-awake comment it split.
- NITs left: kind `other` from an unknowable folder offers a retry that will give the same answer; if the rows
  cannot be read back after a click, the line may mention a switch the page has just taken away.

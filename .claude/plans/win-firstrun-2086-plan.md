# Plan: Windows first-run screen shows macOS-only instructions (kosmos#2086)

Branch: `win-firstrun-2086` · Repo: joshualeestone/kosmos (local checkout `~/work/agent-workforce`)

## The bug (verified on real Windows by windows-orchestrator, 2026-09-03)

The board's first-run screen tells a Windows user to do macOS-only things before
they reach the agents pane: "Type Kosmos into Spotlight" and "Drag Kosmos onto the
Dock." The board UI had no platform awareness ("Spotlight" once, unguarded; "the
Dock" 14x; zero Start menu/taskbar/win32).

## Where the macOS text comes from (measured)

- **Server, the PRIMARY source:** `engine/machine.js` `appLocationCheck` (and
  `appLocationUnknown`) hardcode the "Spotlight" instruction in their `detail`. This
  is what a Windows user NORMALLY sees on the app-location row (the client fallback
  fires only when the fetch fails).
- **Client:** `web/index.html` - the Success-screen Dock hint (`#fr-return-keep`,
  static markup) and the app-location fetch-failed fallback (the client Spotlight).

## Scoping decision (the #2038 discipline)

`engine/machine.js` is entirely macOS-shaped: `appLocationCheck` looks in
`/Applications` and `~/Applications` for `Kosmos.app`, with ZERO Windows awareness.
Making its app-location LOGIC Windows-correct (where Kosmos installs on Windows, the
Windows equivalent of the check) is genuinely part of the #570 Windows umbrella and
needs windows-orchestrator's Windows-install design - blind-building it risks
colliding with their proper fix (two systems that must agree).

So this change fixes only the macOS-only WORDING, keyed on platform, at both layers -
NOT the app-location logic. It removes the wrong macOS instruction off macOS
(satisfying the acceptance "no Spotlight/Dock on Windows") while leaving the deeper
Windows-app-location logic to #570, which can extend the one helper rather than a
second copy.

Neutral, not Windows-specific ("Start menu"/"taskbar"), on purpose: I have no Windows
machine to verify Windows-specific behaviour, and the acceptance allows neutral text.

## Changes

- **`engine/machine.js`:** new `findAppHint(platform)` helper (macOS -> Spotlight
  wording; every other platform -> neutral "Open Kosmos the way you normally open
  apps"). `appLocationUnknown(platform)` and `appLocationCheck(opts.platform)` use it;
  both default to `process.platform` and are overridable so the branches are testable
  from any OS (the #2039 lesson: one resolver, asserted on a simulated platform).
  Exported for tests.
- **`web/index.html`:** client mirror - `frIsMac()`/`frFindAppHint()` and
  `frApplyPlatformCopy()`, called in `firstRunBoot` before `frOpen()`. On non-mac it
  rewrites `#fr-return-keep` to neutral wording and the fetch-failed fallback uses
  `frFindAppHint()`. macOS keeps the static Spotlight/Dock markup unchanged, so it is
  Mac-transparent.

## Tests / verification

- **Server (verified):** `engine/machine.test.js` - `findAppHint('darwin')` has
  Spotlight, `findAppHint('win32'|'linux')` does not, and the two branches differ (a
  control that returns the dangerous answer); `appLocationCheck({..., platform:'win32'})`
  keeps the ATTENTION state but drops Spotlight/Dock/Applications. Full engine suite green.
- **Client Mac path (verified):** `docs/browser-checks/render-first-run.js:515`
  REQUIRES the Dock line on the Success screen (Josh's 2026-08-27 ruling); it runs on
  macOS, where `frIsMac()` is true and the static markup is preserved, so it stays
  green. Confirmed the static Dock markup is unchanged.
- **Client WINDOWS render (NOT verified here, flagged):** verifying the Windows client
  render needs either a Windows machine (windows-orchestrator has one and verified the
  bug) or a Playwright browser check overriding `navigator` to Windows. I have neither
  loaded, so per the Renet Tilley brief I did the parts that do not need Windows
  (the server fix is unit-tested; the client logic is pure and Mac-transparent) and
  flag the Windows-render confirm as windows-orchestrator's step. Leave-for-review.

## The wider class (out of this card's scope, named for the next person)
The same macOS-only wording lives on two surfaces OUTSIDE the first-run screen, left
for a follow-on so this PR stays scoped to the card:
- `web/index.html:9528` - the Settings `#set-reveal` section: "Drag it onto the Dock".
- `web/index.html:12592` - the not-answering toast: "Open Kosmos from your Applications
  folder" (machine.js/client toast copy).
Both can adopt the same `findAppHint`/`frFindAppHint` helper this PR introduces.

## Coordination
- PigeonPete owns #2007 (agents-pane 403), also in `web/index.html` - coordinated to
  avoid a collision; his edit is the agents pane, mine is the first-run instructions.
- The deeper Windows app-location LOGIC in `machine.js` is #570 (windows-orchestrator).

## Rejected
- Making `machine.js`'s app-location logic Windows-aware here (blind, #570-owned, collision risk).
- Windows-specific wording ("Start menu"/"taskbar") - unverifiable without a Windows machine; neutral is safe and acceptance-allowed.

## Weakest premise
The client Windows render is reasoned, not run-verified (no Windows machine / Playwright
here). Mitigated: the change is Mac-transparent (existing browser checks green), the
server half is fully tested, and the logic is a pure boolean gate.

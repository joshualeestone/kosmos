# webkitshots-6206: the settings accounts screens turn the service worker off, as their stubs need (#6206)

## Problem
Three mobile-shots screens timed out on WebKit at every size and theme (settings-accounts-expiring,
settings-add-qwen-downloading, settings-accounts-landed); they pass on Chromium. Reproduced on origin/main.

## Cause (measured)
Each stubs GET /api/accounts (or the Ollama route) with page.route, then navigates again with `at`. In WebKit the
board's service worker, in control after the first load, answers the request before the stub can, so the page draws
the throwaway board's real (empty) accounts and the row each screen waits for never appears. The tool's header
already states the rule ("noServiceWorker: true if go stubs a request with page.route"); these four screens did not
follow it. A one-load probe in WebKit with the same stub drew the row, which is consistent: no worker in control yet.

## Change
docs/browser-checks/mobile-shots.js: `noServiceWorker: true` on settings-accounts-expiring, settings-accounts-landed,
settings-add-qwen and settings-add-qwen-downloading (settings-add-qwen is the base the downloading screen runs; it
was not named on the card but has the same gap).
Found by reading every screen: a screen stubs if its body calls page.route, calls a helper that does (openConsAgents,
connectPending, joinWaiting, orgConnected, stubRebootNote: every caller already flagged), or runs another screen that
does. Exactly these four were unflagged.

## Guard
tools.mobile-shots-serviceworker-6206.test.js: every stubbing screen sets the flag; CONTROL that the reader sees
direct, helper and screen-to-screen stubbing (allow-card, connect-sheet, settings-accounts-landed); CONTROL that a
planted unflagged screen is caught and a flagged one is not. Removing one flag reds it, naming the screen.

## Measured
Before: 3 of 3 webkit shots errored (iphone15, light). After: the four screens at se, iphone15, promax and android,
light and dark, webkit and chromium: 64 shots, 0 errors, 0 overflow; the webkit landed shot shows the stubbed rows.

## Weakest premise
That the worker is the only WebKit difference for these screens. The 64-shot run says it is enough today; a screen
added later that stubs in some way this reader does not model (a route on the context, not the page) is not caught.

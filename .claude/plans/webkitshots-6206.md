# webkitshots-6206: the settings accounts screens turn the service worker off, as their stubs need (#6206)

## Problem
Three mobile-shots screens timed out on WebKit at every size and theme (settings-accounts-expiring,
settings-add-qwen-downloading, settings-accounts-landed); they pass on Chromium. Reproduced on origin/main.

## Cause (measured)
Each stubs GET /api/accounts (or the Ollama route) with page.route, then navigates again with `at`. In WebKit a
request from a page the board's service worker controls (it is in control after the first load) is fetched on the
worker's side, where page.route never sees it; web/sw.js itself passes /api/ through. So the stub is skipped, the page
draws the throwaway board's real (empty) accounts, and the row each screen waits for never appears (the same finding
as the allow-card comment). The tool's header
already states the rule ("noServiceWorker: true if go stubs a request with page.route"); these four screens did not
follow it. A one-load probe in WebKit with the same stub drew the row, which is consistent: no worker in control yet.

## Change
docs/browser-checks/mobile-shots.js: `noServiceWorker: true` on settings-accounts-expiring, settings-accounts-landed,
settings-add-qwen and settings-add-qwen-downloading (settings-add-qwen is the base the downloading screen runs; it
was not named on the card but has the same gap).
Found by reading every screen with the guard's reader (review 1 widened it): a screen stubs if its body calls .route(
on the page or its context, calls a helper that does at any depth (openConsAgents, connectPending, joinWaiting,
orgConnected, stubRebootNote; every caller already flagged), or runs another screen that does, in either SCREENS.find
form the file uses. Bodies are brace-matched, skipping strings and comments. Exactly these four were unflagged.

## Guard
tools.mobile-shots-serviceworker-6206.test.js: every stubbing screen sets the flag; CONTROL that the reader sees
direct, helper and screen-to-screen stubbing (allow-card, connect-sheet, settings-accounts-landed); CONTROL that a
planted unflagged screen is caught and a flagged one is not. Removing one flag reds it, naming the screen.

## Measured
Before: 3 of 3 webkit shots errored (iphone15, light). After: the four screens at se, iphone15, promax and android,
light and dark, webkit and chromium: 64 shots, 0 errors, 0 overflow; the webkit landed shot shows the stubbed rows.

## Weakest premise
That the worker is the only WebKit difference for these screens. The 64-shot run says it is enough today. The
reader is a text reader: a stub reached in a way it does not model (a helper passed as a value, a regex literal that
holds a brace or quote) can still slip past it.

# #2912 - "Check Again" forces a fresh native a11y re-measure (fresh-install, no FDA)

## The bug (Josh re-reported live 2026-09-21)
On the "Kosmos Never Sleeps" (S3 Automation) screen, on a FRESH INSTALL with NO Full
Disk Access, the "Check Again" button does not detect a freshly-granted Accessibility
permission until the app restarts. It looks like it waits on a 30-60s timer.

## Root cause (Angel's diagnosis, confirmed against source)
- The button IS wired correctly: frRecheckPress -> frRecheckGates -> frPollGates, which
  re-reads /api/a11y-status on demand.
- The SOURCE is the problem. /api/a11y-status serves appGrant() (engine reads the app's
  Accessibility TCC row live) which requires Full Disk Access. On a no-FDA fresh install
  that read fails (checkable:false) and the route falls back to read() = a11y-status.json,
  a file the NATIVE app rewrites only on a 60s timer. "Check again" can re-read that file
  but cannot force it fresh, so the re-poll returns the same stale verdict.
- (WITH FDA the live appGrant path already flips within one 750ms poll - #2559/#2911. The
  bug is specific to the no-FDA fresh-install fallback.)

## Decided fix (Angel's Option A - an on-demand native re-measure, accepted)
An app checking its OWN trust via AXIsProcessTrusted() needs no FDA. So expose an
on-demand re-measure the board can trigger: "Check again" asks the native app to run the
axcheck NOW and rewrite a11y-status.json immediately, bypassing both the FDA-gated
appGrant read and the 60s timer.

This mirrors the EXISTING on-demand-prompt seam I built (#2451/#1: /api/a11y-prompt ->
promptrequest -> the native startPromptRequestWatcher fires the hatch under tmux). A
re-check must NOT re-surface the system prompt, so it fires the CHECK hatch
(--kosmos-app-axcheck), never the PROMPT hatch.

## The change (4 wiring pieces + 3 test arms), all in my #2125/#2347/a11y-prompt footprint
1. engine/promptrequest.js: add category `'a11y-recheck': 'a11y-recheck-request'`.
2. server.js: add POST /api/a11y-recheck -> promptrequest.request('a11y-recheck'). Same
   fire-and-forget {ok, because} contract as /api/a11y-prompt.
3. native-app/main.swift: startPromptRequestWatcher's checkPromptRequests adds the name +
   a consumeRequest("a11y-recheck-request") that fires ONLY spawnAxHatchUnderTmux(hatch:
   "--kosmos-app-axcheck") - a fresh AXIsProcessTrusted read that rewrites a11y-status.json
   at once. No axprompt.
4. web/index.html frRecheckGates: before the re-poll, POST /api/a11y-recheck fire-and-
   forget, guarded to when the app-accessibility gate (`[data-gate="tmux"]`) is on this
   screen and not platform-hidden. Fired ONLY from the manual frRecheckPress path (not the
   750ms auto-poll), so it spawns one hatch per press, not per tick.

Tests:
- promptrequest.test.js: request('a11y-recheck') records the file; ROUTE CONTRACT extended
  to pin /api/a11y-recheck both sides; CROSS-LANGUAGE CONTRACT auto-covers the Swift
  consumer.
- web.firstrun-a11y-1214.test.js: frRecheckGates POSTs /api/a11y-recheck, guarded to the
  tmux gate (bounded to the function body so a stray mention cannot false-pass).

## Why this design and not the rejected ones
- Reuses the proven request-file -> watcher -> under-tmux-hatch pattern (identical spawn
  tree to the launch axcheck; adds no new #2125 attribution assumption).
- Rejected (B) requiring FDA so appGrant works: FDA is a heavier, scarier permission than
  the accessibility grant this flow is even about.
- Rejected (C) shortening the 60s timer: still native, and only narrows the window instead
  of closing it.
- nativePresent() (the guard in promptrequest.request) reads the native file, which the
  app writes WITHOUT FDA - so the recheck request is recordable in exactly the no-FDA case
  it is needed. Verified.

## Weakest premise
That the on-demand axcheck writes a11y-status.json fast enough that the running 750ms poll
reflects it "within a moment." The hatch is a detached under-tmux spawn; on a slow fresh
box the write could lag a poll tick or two. It still lands far inside the 5-min staleness
window and far faster than the 60s timer, and the poll is continuous, so the verdict
appears within a second or two rather than up to 60s. What would change the design: if the
spawn latency is user-visible, mint the verdict inline in the route instead of via the
watcher (larger change, new attribution surface - deferred unless the fresh-Mac verify
shows lag).

## Verification
- JS/wiring: unit tests above (green locally) + the repo node gate.
- Native behavior + the real fix: a fresh-install-no-FDA end-to-end on Josh's 2nd fresh Mac
  (a grant-holding fleet Mac CANNOT reproduce it). Stays needs-operator; Splinter routes the
  fresh-Mac verify when the build is ready. A headless browser cannot verify it (no native
  app); the web arm is designed to be a harmless no-op there.

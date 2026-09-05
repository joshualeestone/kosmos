# #2240: install copy - the Dock icon is already there, drag it to the far left

## The bug (Josh, 2026-09-05 fresh-install feedback, item 1)

Kosmos auto-opens as an app and its icon lands in the Dock while running. The
first-run Success-screen copy said "Drag Kosmos onto the Dock, the strip of
icons along the edge of your screen", which reads as "the app is not in the Dock,
go put it there" - so a user finds Kosmos and drags THAT to the Dock, ending up
with two instances. The fix: tell them the icon is ALREADY in the Dock and to
drag the existing one to the far left.

## The change

`web/index.html` `#fr-return-keep` (the first-run Success screen), from
"Drag Kosmos onto the Dock, the strip of icons along the edge of your screen."
to: "Kosmos is already in your Dock, the strip of icons along the edge of your
screen. Drag its icon to the far left so it stays handy."

Decision (option 2 of Josh's three, reversible - he can swap the wording):
- Keeps the DRAG verb. The existing hard rule in web/index.html: Kosmos.app is
  LSUIElement, so "right-click, Keep in Dock" is unreachable (the tile flashes
  and is gone), and the instruction must stay "drag". Both browser-checks keep
  their `!/Keep in Dock/` guard.
- Keeps the novice explainer ("the strip of icons along the edge of your
  screen") that raw option 2 dropped - better for first-time users.
- Rejected option 1 (does not preempt the go-find-it mistake) and option 3
  (mentions a "second copy", which can confuse a fresh user, and a dash clause).

## Guards updated in lockstep (so they stay meaningful, not vacuous)

- `docs/browser-checks/click-first-run.js`: asserts the new copy PRESENT on the
  Success screen, BOTH halves ("already in your Dock" + "drag its icon to the
  far left"), so it cannot silently drift back.
- `docs/browser-checks/render-first-run.js`: asserts PRESENT on Success, ABSENT
  on the last step.
- `server.test.js`: the leakage guards (the line must not appear in the
  dynamically-repainted `fr-return-msg` or the ending screens) use the NEW
  string, so they still test leakage rather than the absence of a now-nonexistent
  string. 264 server tests pass.

## Scope and follow-up

Scoped to the first-run install flow (the Success screen Josh screenshotted).
The Settings copy (`web/index.html:9880`, "Drag it onto the Dock to keep it one
click away.") carries the same defect on a different surface and is filed as
#2258 rather than expanded into here.

## Verification

`node --test server.test.js` green (264). The two browser-checks
(click-first-run, render-first-run) assert the new copy; they run against a live
board (the release step-3b browser harness), so they are exercised there in
addition to the local browser-check run before PR.

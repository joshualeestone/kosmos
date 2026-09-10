# Plan: delete the phone-home telemetry toggles end to end (#2623)

## Goal
Josh, 2026-09-09, called the two "let the Kosmos team know..." phone-home telemetry toggles an
invasion of privacy and asked for them deleted immediately. Delete both end to end, keeping only
auto-update.

## Scope: two separate telemetry paths, both deleted

### 1. The create-agent ping (engine/ping.js send path)
- DELETE `ping.agentCreated`, the on/off setting (`ping.setOn`, `payload`, endpoint, sender), the
  `/api/ping-setting` route, the `#tell-toggle` Settings > Updates row, the `#create-tell` Create-form
  checkbox, and the `tellKosmos` client send (create form + import path).
- KEEP `ping.installId()` and `ping.underTest()`: `installId` is a random per-install id that never
  leaves the Mac and is a SHARED anchor (engine/store.js, engine/feedback.js, engine/feedbacksend.js);
  `underTest` is read by engine/updating.js to stay inert under test. So engine/ping.js stays, trimmed
  to `{ FILE, read, installId, underTest }`, with `read()` returning only `{ installId }`.

### 2. The "something happened" notify seam (engine/notify.js)
- DELETE engine/notify.js entirely, the `/api/notify-setting` route, the `#notify-toggle` Settings
  row, the notify-off hint on the heartbeat panel, and all four `notify.happened` callers in server.js:
  a reported needs_you, a reply, a room post, and the heartbeat `check_in`.

## Decisions (reversible-in-a-commit, so mine to make; documented for review)

- **Remove the heartbeat check_in delivery too.** It was delivered through the notify seam (a POST to
  installkosmos.com carrying session + timing), gated by the same master switch, so it rode the exact
  phone-home path Josh called an invasion of privacy. The heartbeat runner still detects stalls
  (`heartbeat.step` keeps computing `toAsk` and carrying `heartbeatPrev`); it no longer delivers off
  the Mac. Weakest premise: Josh named the two switches, not check_in. Mitigation: flagged in the PR
  body so he can veto; a non-phone-home delivery is a separate build.
- **Keep engine/wouldping.js.** It writes a LOCAL 0600 diagnostic log (no endpoint, no receiver, no
  switch), sends nothing off the Mac, and does not require notify.js. It is not phone-home, so it is
  outside the mandate. Removing it would edit status.js (core board poll) for no privacy gain.
- **Keep engine/activity.js and the opt-in SendFeedback path** (feedback.js / feedbacksend.js): the
  first is a local working indicator; the second is a separate explicit opt-in, not "tell the Kosmos
  team" telemetry.

## Tests
- Delete the tests for the deleted feature (engine/notify.test.js, web.create-tell.test.js).
- Trim engine/ping.test.js to installId / read / underTest, plus a `#2623` absence guard that each
  removed export is `undefined` (guards against a silent re-export).
- Flip the create-form / heartbeat-hint tests to ABSENCE guards that keep a positive control (the
  Create button; the surviving hb-toggle ids), so they cannot pass vacuously.
- engine.reachable.test.js: add an EXCUSED entry for feedbacksend.setSender, whose #265 orphan guard
  had only ever passed by a plain-text name-collision with the now-deleted notify.js/ping.js setSender.
- Update the Playwright checks under docs/browser-checks that pinned the deleted toggles.
- Comment-staleness pass: heartbeat.js / heartbeat-setting.js / selfreport.js / wouldping.js /
  updating.js references to the removed seam.

## Gates
web/index.html changes trip the browser-check gate chain; full node suite must stay green; challenge-
loop before PR. Beta app: merge on green, squash, no reviewer.

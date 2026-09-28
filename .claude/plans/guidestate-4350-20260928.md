# guidestate-4350: the setup guide's outcome rides the install ping (kosmos#4350)

Splinter's call on the card (covered by Josh's 09-14 telemetry ruling): send the guide
outcome as a state on the EXISTING install ping, count it on /admin, keep ensureGuide's
reason locally, and do not count the auto-created guide as a person-created agent.

## Design (app half; the site half is chaoskosmos-site branch guidestate-4350)
- `ensureGuide` resolves a `state` on every path: seeded, not-armed, off, no-model, refused,
  names-taken, disabled. A retry wait carries none (it says nothing new).
- `engine/guidestate.js`: `setup-guide-state.json` in the store holds {state, reason, at}.
  `record()` reports `changed` only when the STATE changes; the reason stays on the Mac.
- server.js: both ensureGuide call sites `.then(recordGuideOutcome)`, which re-sends the
  install ping on a change (idempotent server-side: count 0 never lowers a count).
- createdbeacon payload gains `guide: <state>|'unknown'`.
- `create.createdCount` leaves out births with createdBy GUIDE_CREATED_BY ('kosmos'), role
  SETUP_ROLE_KEY ('setup') AND a purpose starting with one of GUIDE_PURPOSE_PREFIXES (the
  current one and 0.6.70's), all read from
  setup-assistant.js (lazy require: it requires create.js).
- Seeded before this shipped: the sweep's early return records 'seeded'.
- The change ping waits 30 s, one timer (guidestate.makeRecorder, tested with an injected
  timer), so it cannot race the board-start ping on the collector.
- The state file is written only when something changed; `at` is when the state first appeared.

## Rejected
- A new ping: the card asks for a field on the existing one.
- Sending the reason: it is free text and could carry error details.

## Weakest premise
- That the three-field match identifies only the auto guide. The team route lets an operator
  set createdBy, so each field alone is spoofable; the purpose prefix is what separates them
  (a team member with createdBy 'kosmos' and role 'setup' still counts: tested).
- An install that already reported a count including its guide keeps that higher number on
  the collector (Math.max), so its next creation does not move the public total, once.

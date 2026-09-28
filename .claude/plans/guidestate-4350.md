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
- `create.createdCount` leaves out births with createdBy 'kosmos' and role 'setup'.

## Rejected
- A new ping: the card asks for a field on the existing one.
- Sending the reason: it is free text and could carry error details.

## Weakest premise
- That createdBy 'kosmos' + role 'setup' identifies only the auto guide. A person can create
  a setup-role agent (control in the test), but nothing else writes createdBy 'kosmos' today.

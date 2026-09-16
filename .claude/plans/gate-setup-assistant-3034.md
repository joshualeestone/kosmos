# Plan: #3034 - gate the undirected setup-assistant first-run auto-create OFF

## Why
Josh, 2026-09-16 (6.70 verification): "I don't know why this was set up as complete or
indicated it was complete because we haven't gone through this yet and I haven't given
direction on it."

The setup-assistant auto-create shipped in PR #3153 (my prior work) without Josh having
directed the design. Card #3034 stays needs-decision (the design is Josh's to direct).

## What actually ships today (measured)
- PR #3153 (37213fca1) merged 2026-09-15 21:29 CDT, AFTER the v0669 cut (0107d1c33, 19:21)
  and before v0670 (5f6fb565f, 09-16 06:04). So it rides the UN-CUT 6.70: NOT live in served
  0.6.69 yet, but it ships the moment 6.70 cuts. (The close-out heuristic "ancestor of v0670"
  would mislabel it served; the v0669 ancestry check is the correct one.)
- On first-run completion (POST /api/first-run/complete), server.js calls
  setupAssistant.seedSetupAssistant(), which auto-creates one setup-assistant agent named
  after the user. There is no explicit "complete" text: the "indicated complete" signal is
  simply that an agent the user never made appears on the Agents screen.

## The fix (a gate, not a design change)
- `engine/setup-assistant.js`: add `FIRSTRUN_AUTOCREATE_ENABLED = false`, exported. The seed
  LOGIC (seedSetupAssistant and its design decisions) is left fully intact so Josh's direction
  has something to turn on.
- `server.js`: wrap the first-run seed call in `if (setupAssistant.FIRSTRUN_AUTOCREATE_ENABLED)`,
  so the undirected auto-create is not wired into onboarding while the flag is off.
- Flip the flag to true when Josh directs the design. Reversible in a commit, per his
  make-your-best-call ruling; he can override.

## Why this shape
- Gating the WIRING (server.js) rather than the module keeps the design pristine and its
  existing tests valid (they call seedSetupAssistant directly with injected deps).
- The flag lives with the feature (engine/setup-assistant.js), so it is discoverable, and it
  is trivially testable.

## Verification
- Added a guard test to `engine.setup-assistant-3034.test.js` asserting
  `FIRSTRUN_AUTOCREATE_ENABLED === false`, PROVEN to fail when flipped to true (fail 1) and
  pass when false, before being trusted.
- The seed-logic tests are unchanged and still pass (the design is untouched).
- Backend-only change (server.js + engine); no web/ diff, so no browser-check applies.

## Scope / non-goals
Does NOT build or change the setup-assistant design (Josh's to direct). Does NOT remove the
engine. Only gates the first-run wiring off so undirected behavior does not ship on the cut.

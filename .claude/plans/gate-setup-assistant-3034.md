# Plan: #3034 - gate the undirected setup-assistant first-run auto-create OFF

## Why
Josh, 2026-09-16 (6.70 verification): "I don't know why this was set up as complete or
indicated it was complete because we haven't gone through this yet and I haven't given
direction on it."

The setup-assistant auto-create shipped in PR #3153 (my prior work) without Josh having
directed the design. Card #3034 stays needs-decision (the design is Josh's to direct).

## What actually ships today (measured, corrected 2026-09-16 ~11:17 CDT)
- The undirected auto-create is LIVE IN PROD RIGHT NOW. 0.6.70 went served ~10:52 CDT today
  (latest.json = 0.6.70 on both domains, per Splinter), and PR #3153 (37213fca1) is an
  ancestor of the v0670 bump (merged 2026-09-15 21:29 CDT), so it is in the served 0.6.70
  build. This is why Josh is seeing a setup-assistant agent he did not create.
- Earlier in this session the served build was 0.6.69 and #3153 rode the un-cut 6.70 (it
  merged 21:29, AFTER the v0669 cut 0107d1c33 at 19:21). The 0.6.70 cut at ~06:04/served
  ~10:52 moved it live. The correct served test is "ancestor of the LATEST served version
  bump" - now v0670, not v0669; the model was one cut stale, not the method.
- This gate takes effect in the NEXT cut (6.71): flipping the wiring off on main removes the
  auto-create from the build after this one, and Josh can direct/flip it before then.
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

The gate is FORWARD-LOOKING and does not clean up already-shipped state (worth Josh knowing
when he directs the design): users already on the served 0.6.70 build keep the assistant that
was auto-created and its once-ever `setup-assistant.json` flag. Because that flag is a
once-ever guard, flipping FIRSTRUN_AUTOCREATE_ENABLED back to true later will NOT re-seed
those users (they already have one, and we must not re-create one they may have deleted). So:
existing 0.6.70 users keep theirs; users who onboard on the gated cut (6.71+) get none until
Josh directs it; and no already-shipped state is touched or reverted. If Josh wants the
already-shipped agents removed, that is a separate, deliberate cleanup, not this gate.

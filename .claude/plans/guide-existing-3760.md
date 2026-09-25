# guide-existing-3760: existing installs get the setup guide once on update

Card: kosmos#3760. Josh, 2026-09-25 11:07 (0.6.94): "anybody that has a current install won't have the
helper agent. Is there a way to activate that for existing users and then allow them the ability to turn
it off, like we normally would let new users turn it off".

## Why they never got it
`ensureGuide` creates the guide only on an ARMED install, and only first-run completion (Giddy Up) arms.
That was deliberate (#3660: do not put an unasked-for agent on every existing board). Josh has now asked
for exactly that, once, with the same off switch as a new user.

## What
- `engine/setup-assistant.js` `armExistingInstall({ firstRunSeen })`: writes the arm file
  (`via: 'update'`) when the install is not armed and its first run is FINISHED (`firstrun.seen()`
  known and done). Never throws.
- `server.js`, at board start, just before the guide sweep, behind `FIRSTRUN_AUTOCREATE_ENABLED` and
  skipped under the test dry run (as ensureGuide is): `armExistingInstall({ firstRunSeen: firstrun.seen })`.
- Everything after arming is the new-user path unchanged: the sweep's `ensureGuide` creates one guide,
  once ever (seeded flag), not while setup assistance is off (the Settings switch, and the close-forever
  option being built on the close-copy card), and not without a usable model.

## Decided
- Arm at start rather than seed directly: one creation path, so every existing rule (once ever, off
  switch, name fallback, backoff, a model that can run) applies to existing installs without a copy.
- An unreadable first-run flag does not arm. firstrun treats it as done so onboarding is not shown over a
  working board; creating an agent on a guess is the opposite direction.
- A fresh install mid-onboarding is left to Giddy Up, so a fresh install is unchanged.
- The wiring guard in engine.setup-assistant-3034.test.js keeps "armSetupAssistant only at Giddy Up" and
  adds: armExistingInstall once, behind the switch, fed the real first-run reader.

## Weakest premises
- Every existing board with a finished first run and a model gets a guide at its next start, including
  the fleet's own boards. That is what was asked; the off switch is the way out.
- Someone who removed a guide is not given another (seeded is once ever). Someone who never had one but
  closed the hosted bubble with "don't show again" has setup assistance off, so gets none.
- Not verified on a real update: the tests drive the engine with injected accounts. A real check needs a
  pre-guide install updated to a build carrying this.

## Verification
- engine.setup-assistant-3034.test.js: existing install armed once and one guide, none on a later start;
  a fresh install mid-first-run and an unreadable flag not armed; turned off gets none across a restart,
  and the control with it back on does. Mutations: arm regardless of first run, trust an unreadable
  flag, drop the already-armed check, drop the server call, ignore the off setting: all RED.

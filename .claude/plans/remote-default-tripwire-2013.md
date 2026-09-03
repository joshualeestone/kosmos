# remote-default-tripwire-2013 -- a test that pins remote's default-off coupling (#2013 follow-up)

## Why
#2013 fixed a typeof-array hole in `engine/heartbeat-setting.js`: `typeof [] === 'object'`
let a JSON array config bypass the corrupt->off guard, and because heartbeat defaulted
ON, a corrupt array turned into phoning home.

`engine/remote.js` has the IDENTICAL shape guard (`!parsed || typeof parsed !== 'object'`),
but it is safe TODAY: remote reads `on: parsed.on === true` (explicit-true) and is OFF by
default, so an array's undefined `.on` reads false either way. It is a DORMANT defect whose
only trigger is remote's default flipping to ON -- and that trigger is a COMMERCIAL
decision (Josh carved remote out of the on-by-default sweep 2026-09-03 because the Remote
tunnel is a paid service), not a technical one. Commercial reasons change.

## What (test-only; remote.js deliberately UNCHANGED)
A card would ask a future person -- editing a billing default, not thinking about `typeof`
-- to remember a shape bug and search the backlog for it. They will not. An assertion runs
every time and reds AT THE MOMENT of the change, in front of that person, carrying the fix.
So this adds one test to `engine/remote.test.js`:
- assert a missing config reads OFF (the trigger tripwire), with a failure message that
  says: before shipping default-on, fix the typeof-array hole in the shape guard;
- assert a JSON ARRAY config reads OFF (the hole pinned directly), which reds the moment
  someone gives remote a heartbeat-style default-true read.

`remote.js` is deliberately NOT changed: there is no bug to fix today, and adding an
`Array.isArray` guard now would flip `ok` for a corrupt array -- a behaviour change to code
with no live defect. The tripwire records WHY the guard matters so nobody removes its
precondition (the off-default) without seeing it. This is the same instinct as #2023's
in-code negative-knowledge comments, one step on: record why a guard matters so nobody
removes its precondition unseen.

## Verification
- `engine/remote.test.js` 22/22 green.
- Proven non-vacuous: perturbing remote.js to a `typeof parsed.on === 'boolean' ? .. : true`
  read reds assertion #2 with its intended "add Array.isArray" message; reverted, remote.js
  is byte-identical to origin/main (only remote.test.js changes on this branch).

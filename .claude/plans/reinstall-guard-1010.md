# kosmos#1010 (Mac-side sign-in): a reinstall whose state survived is recognised, not re-enrolled

## The card, and what was already done
kosmos#1010 (Baron Draxum, 2026-08-26): a reinstall of the same Mac arrives at the
coordinator as a stranger and is told a name is "your other Mac's" — for its own
previous life. Most of the card is already fixed:
- Baron fixed the two costs (allow-list + certificate preservation) in kosmos-relay
  `e695dd8` (on main).
- #1057 replaced the flat "your other Mac" wording with an accurate three-way
  message in the coordinator.
- The coordinator side is done; it cannot safely auto-recognise a reinstall because
  an account can have MANY Macs (keying on "same account reclaiming a held name"
  would misfire on a genuine second Mac).

## What was still open (this PR)
Card item 1: "a reinstall whose state survived should not re-run enrolment at all.
`enrolled()` already reads true in that case and nothing consults it before
`setupComplete`." Confirmed: `engine/remote.js setupComplete()` never checked
`enrolled()`, so a reinstall (install/setup.sh keeps Application Support, so
mac_id/address/tls survive) re-ran enrolment — minting a NEW identity key
(`crates/tunnel setup.rs`, a fresh key by design, #1003), spending a scarce
certificate, and hitting the coordinator's 409.

## The fix
A guard at the top of `setupComplete`: when `enrolled()` is true AND `address()`
already maps to the requested name, recognise the Mac as itself, bring the tunnel
up, and return `{ ok: true, alreadySetUp: true, address }` — without re-running
enrolment. A DIFFERENT name is a rename (a real address change) and deliberately
falls through to the normal setup path.

## Scope / not in scope
- This is the minimal, correct backstop the card's item 1 names ("nothing consults
  enrolled() before setupComplete"). It stops the re-enrolment, the key churn, the
  cert spend, and the 409 for a same-name reinstall.
- The fuller version keeps an already-enrolled Mac out of the setup UI in the first
  place (touches the Settings/setup flow in web/index.html) and wants a browser
  walk of the reinstall flow to verify end to end. Deferred as a follow-up; the UI
  can also read the new `alreadySetUp` flag to show "connected as X" rather than a
  generic success.
- Identity-persistence across a deliberate wipe stays NO (#1003). The coordinator
  copy is unchanged (no client sends `replace`).

## Testing
`engine/remote.test.js` gains a test that enrols, then re-runs setup with the SAME
name and asserts the guard recognises it (`alreadySetUp`, no second `setup complete`
reaching the fake binary), plus a CONTROL that a DIFFERENT name still enrols
(name-specific, not a blanket no-op). Verified the test REDS when the guard is
removed (mutation), so it catches the actual defect.

## Weakest premise
The guard keys on `address()`'s name-label matching the requested name. If a
person's surviving state is at name A and they deliberately ask for A again after a
reinstall, they are recognised (correct). If the state is somehow stale/wrong (an
address file that no longer matches the coordinator's record), the guard would still
recognise it locally; but that is the same trust the rest of the client already
places in the local state dir (`enrolled()` is a local-file check), so it introduces
no new trust. A different name always falls through to the real setup path.

# cloudallow-8525 (kosmos#8525)

## Problem
A member with a computer who buys Kosmos Cloud cannot allow the new cloud machine. The tunnel
(kosmos-relay crates/tunnel/src/devices.rs, #4903 D2) lists it as a `computer:` row with
`cloud: true`, no `joining_computer` and no code, by design: Kosmos+ holds root on the machine, so
a code compared with it proves nothing, and its Allow only tells Kosmos+ (`allow_outcome`).

The board had two blocks:
1. engine/remote.js pendingDevices dropped `cloud` and mapped every `computer:` row without
   `joining_computer` to `code_wait: 'was_a_computer'` (#6315), drawn as "cannot be allowed".
2. engine/remote.js deviceAllow refused any code-less Allow of a `computer:` id (#6315).

## Change
- pendingDevices carries `cloud` (only a JSON `true`) and exempts it from the was_a_computer map.
- isComputerRow counts `cloud === true`, so board-v2 keeps the row and its route.
- deviceAllow skips the code rule only for an id the tunnel's own pending.json marks cloud
  (listedAsCloud). The page's word is never trusted for this; the tunnel re-decides from its live list.
- web/index.html: askHead "Your cloud machine "<name>" wants to join"; the say line; Allow label.

## Rejected
- Trusting a `cloud` flag sent by the page to the Allow route.
- Having the relay send `joining_computer` for cloud rows (would run a meaningless pairing).

## Tests
- engine/remote.joincode-4794.test.js: three #8525 tests with controls.
- web.allow-card.test.js: askHead behaviour with controls.
- docs/browser-checks/render-connect-sheet-4637.js: cloud arm and was_a_computer control, 1400 and 390.

## Weakest premise
That a live tunnel's pending.json carries `cloud: true` for such a row (read from relay main's code,
not from a real file). Proven only when a release with this reaches a computer and Allow is pressed.

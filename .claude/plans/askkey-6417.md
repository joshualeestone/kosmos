# askkey-6417: a dismissed Kosmos+ notice comes back when a joining computer asks again

Card: kosmos#6417. Stacked on agenone-6405 (#6418, #6405), which adds askComputerRow; rebased onto main once it merges.

## What changes
- web/index.html paintAsk: the compact notice's put-away key (noteKey) was device_id@first_seen@denied_at. A joining
  computer keeps ONE row across every attempt (one first_seen), so once dismissed it never came back. For a computer's
  row (askComputerRow) the key also carries its code: a new code is a new attempt and brings the notice back. A row
  whose code is empty counts as put away when any of that row's codes was (noteAway). Phones and browsers keep the old
  key exactly.

## Decided
- Only a new code brings it back. The tunnel empties a computer's code while an attempt starts, while it waits
  (code_wait), and when a code lapses after ten minutes (kosmos-relay crates/tunnel/src/pairing.rs REVEAL_TIMEOUT_SECS); none of those is a new request, so none shows the notice
  again. code_wait is therefore not in the key (first thought, from Angel's point, then dropped once the tunnel's
  sequence was traced: waits would have brought it back with nobody asking).
- A notice dismissed before an attempt's first code arrives shows again when that code arrives: the code is what the
  person needs to act on. Stated, not tested.
- Stateless: matching an empty code against the stored keys survives a reload and other tabs, with no memory of the
  last code.
- Keys stored before this change (no code part) do not match a computer's new key, so a computer request already
  dismissed shows once more after the update. Harmless.
- Review and the close button put away the same keys (ASK.noteKeys is built with noteKey), so both follow this rule.
- No new UI: the same notice, shown again when it should be.
- Weakest premise: that a new attempt always brings a new code. If the tunnel reused a code for a new attempt, the
  notice would stay away for it, as before this change.

## Tests
- docs/browser-checks/render-plus-asks-signin-4610.js: a joining computer dismissed on one code stays put away on the
  same code (CONTROL), when its code lapses, and while it waits with no code; another computer whose id starts the
  same way, with no code and never put away, shows (the prefix is not over-broad); the first comes back with a new code.

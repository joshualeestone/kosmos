# owncode-4699: an own code only joins a computer on the same account (kosmos#4699)

## Why
Found by Renet Tilley's end-to-end proof of the own room (#4693). An "add your other computer" code
(kosmos#4649) carried only the project's room ref and name. Pasted on a computer signed in to a DIFFERENT
Kosmos+ account, it was accepted: that computer got a project sitting alone in ITS account's own room, under
a note saying it was shared with the person's other computers. Nothing leaked (an own-room seat is only
ever minted for the caller's own account). The screen made a false promise.

Second item on the card: a room shared only with the person's own computers said "the external project" in
its room notes.

## Change
- An own code names the computer that made it: `from`, that computer's Kosmos+ name (the first label of
  its address). The code's format is `v: 2`.
- Verify accepts an own code only when `from` is one of THIS computer's account's computers. It asks the
  coordinator through the tunnel (`POST /v1/mac/account-computers`, signed with this computer's key, so it
  can only be this account's list). Refusals, each with a sentence and a reason:
  - `other-account`: the maker is not on this account (a different account, or a computer since removed);
  - `unchecked`: the list could not be read (not accepted on trust);
  - `old-code`: a `v: 1` code, which names no computer.
- The own-code route refuses when this computer has no Kosmos+ address (it has no name to give), before
  anything is recorded.
- engine/fedseats.js: the far side of a room is "your other computers" when the room is an own room (a
  `self` link, or an owner project shared by own code), in every room note that named it.

## Decided
- **The maker's NAME, not an account fingerprint.** The card said "carry an account fingerprint (a hash of
  the account id)". The board holds no account id: the coordinator would have to publish one, which is a
  relay change and a deploy, to answer a question the signed computer list already answers. Rejected for
  that reason. A name is not a secret and is already that computer's public address.
- **Fail closed when the list cannot be read.** A join needs the coordinator a moment later anyway.
- **`v: 1` codes are refused, not grandfathered.** Accepting them would keep the hole for any code made by
  a computer that has not updated. The sentence says what to do.

## Weakest premise
That the maker is still on the account, under the same name, when the code is pasted. A computer renamed or
retired after it made a code invalidates that code, and the refusal cannot tell that from a different
account (it says both). A code is made to be pasted within minutes, so this should be rare.

## Not covered
- The coordinator's answer is not signed. An impersonated answer could list any name, which only defeats
  this mistake-prevention check; it grants no seat in anyone's room (the seat is minted per account).
- A computer still waiting to be allowed on its account (kosmos#4681) is refused the computer list, so it
  cannot join by own code until it is allowed. That is intended.
- Renet's harness (tools/fed-own-e2e.js, #4693) turns its NOTE into a check once this lands; that change is hers.

## Checks
- engine/federation-owncode-4649.test.js: a code without a maker is never made and records nothing; a code
  from this account's computer verifies with exactly one signed read and nothing redeemed; one from another
  computer is refused and holds nothing for a join (with the control that the same ref is then accepted
  from an account computer); an unreadable list refuses; a v 1 code refuses without asking the coordinator.
- server.federation-3311.test.js: the same at the routes, the no-address refusal, and the code carries
  this computer's name.
- docs/browser-checks/render-owncode-4649.js: the code names its maker; a code from a computer not on the
  account shows the refusal's words on the join screen.
- engine fedseats tests: unchanged and green (113).

## Review 1 (sonnet)
FIXED:
- The account's computers are matched on the first label of each row's ADDRESS, the same derivation that
  made `from`, not on the row's `name` field (the two are separate fields and need not be spelled alike).
  Tested with a row whose name differs from its label, and one whose name alone matches.
- `unchecked` shows its cause on the join screen (remote access off, a computer not allowed yet), not the
  generic "try again in a moment", which for those causes can never succeed.
- The sealed-rooms note also names the far side correctly; one helper, not two that differ by a capital.
NOT AN ISSUE AS DESCRIBED: "the connector-too-old note still says the external project for a self link".
That line is reached only when the link is neither `self` nor an owner seated in its own room; those take
the branch above it, which already says "your other computers" (engine/fedseats.test.js pins both).
STATED, NOT FIXED:
- A NEW code on an OLDER Kosmos: its parser accepts only `v: 1`, so a `v: 2` code is read as an ordinary
  invite and refused in generic words, with no hint to update. Own codes first merged to main on
  2026-09-30 (#4704), so the only boards with that parser are builds cut from main that same day.
- The order of refusals: a code whose room is already on this computer says "already on this computer"
  before the account is checked.

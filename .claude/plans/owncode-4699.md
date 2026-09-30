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
  its address). The code's format number stays `v: 1` (review 4): an older Kosmos ignores `from` and reads the code as before.
- Verify accepts an own code only when `from` is one of THIS computer's account's computers. It asks the
  coordinator through the tunnel (`POST /v1/mac/account-computers`, signed with this computer's key, so it
  can only be this account's list). Refusals, each with a sentence and a reason:
  - `other-account`: the maker is not on this account (a different account, or a computer since removed);
  - `unchecked`: the list could not be read (not accepted on trust); `no-remote` when this computer is
    not signed in to Kosmos+;
  - `old-code`: a code with no maker (`from`), which is what a Kosmos from before this change makes.
- The own-code route refuses when this computer has no Kosmos+ address (it has no name to give), before
  anything is recorded.
- engine/fedseats.js: the far side of a room the person's own computers sit in (a `self` link, or an
  owner project shared by own code) is "the other computers in this project", never "the external
  project". Those words are true whether or not a guest from another account is in the same room, which
  this computer cannot tell before its seat is up. A record that cannot be read gets the same words.
## Decided
- **The maker's NAME, not an account fingerprint.** The card said "carry an account fingerprint (a hash of
  the account id)". The board holds no account id: the coordinator would have to publish one, which is a
  relay change and a deploy, to answer a question the signed computer list already answers. Rejected for
  that reason. A name is not a secret and is already that computer's public address.
- **Fail closed when the list cannot be read.** A join needs the coordinator a moment later anyway.
- **A code with no maker is refused, not grandfathered.** Accepting it would keep the hole for any code
  made by a computer that has not updated. The sentence says what to do. (The format number is still 1:
  what is refused is the missing `from`, not the number.)

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
- The one refusal with its own sentence ("this computer has not been allowed yet") is recognised by the
  code the connector prints in its refusal line (`..., code own_lineage)`). NO MERGED OR DEPLOYED connector
  prints that yet: it is on kosmos-relay's unmerged `selfack-4665` branch. The test's line is written to
  that branch's shape, so the matcher and the test agree with each other and with that source, not with a
  shipped binary. Until that connector ships, a waiting computer gets the general sentence.

## Checks
- engine/federation-owncode-4649.test.js: a code without a maker is never made and records nothing; a code
  from this account's computer verifies with exactly one signed read and nothing redeemed; one from another
  computer is refused and holds nothing for a join (with the control that the same ref is then accepted
  from an account computer); an unreadable list refuses; a code with no maker (made before this change) refuses without asking the coordinator.
- server.federation-3311.test.js: the same at the routes, the no-address refusal, and the code carries
  this computer's name.
- docs/browser-checks/render-owncode-4649.js: the code names its maker; a code from a computer not on the
  account shows the refusal's words on the join screen.
- engine fedseats tests: green, with one test added for the far-side wording.

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

## Review 2 (fable): 2 WARNINGs, 4 NITs

- W1 FIXED: three room notes in server.js `federateOut` still said "the external project" on own rooms. They
  use `fedseats.farSide` (now exported); the unreadable-record note says "nothing is sent from this room",
  since without the record nobody can say which side it is. Test pins an own (`self`) room, with the
  member room as the control; reverting the note turns it red (checked).
- W2 FIXED: the `unchecked` refusal printed the raw cause, which can carry a path (a spawn ENOENT) or a
  route and status (the tunnel's refusal line). `uncheckedRefusal` now maps: not connected -> reason
  `no-remote` with the way forward; a coordinator refusal -> only its sentence, the `(HTTP n on path)` tail
  stripped, dropped if it holds a slash, no retry advice; anything else -> the generic sentence. Test
  asserts no slash, HTTP code or ENOENT reaches the person on all three.
- NIT 3 FIXED: the "nothing is held" test now asserts `joinSnapshot` is null right after the refusal.
- NIT 4 FIXED as one wording: the server's `other-account` parenthetical is gone, so both copies read alike.
  The page keeping its own table is the page's convention for every reason (self-shared, not-plus too).
- NIT 5 FIXED: the route constant is `account-computers.js`'s ROUTE. The looser label rule stays on
  purpose: it compares labels only, and the answer is unsigned either way (Not covered).
- NIT 6 FIXED: the browser check's header names the refusal-in-words assertion.

## Review 3: found nothing to act on (07:5x CDT, before the merge of main). Not written down at the time;
the model was not recorded.

## Review 4 (opus), on the head merged with main: 3 WARNINGs, 2 CONVENTIONs
Run because a merge of main came after review 3. It found three real things the first three had not.
- W FIXED: `uncheckedRefusal` matched `^Kosmos+ refused this Mac:`, and the tunnel prints `Error: ` first
  (its fake in remote.test.js writes it that way; `retireReason` strips it for the same reason). So the
  branch that shows the coordinator's own sentence never ran on a real refusal: a computer not yet allowed
  on its account was told "Try again in a moment", which can never succeed. My test had handed it a
  hand-written line without the prefix. The prefix is stripped now, and the test uses the real shape.
- W FIXED: `farSide` called an owner project shared by own code "your other computers" even when a guest
  from another account sits in the same room (the owner's seat is on the guest's edge then). Those notes
  said "the external project" before this branch, which was true for that case. It now says "the other
  computers in this project" when the seat is on a guest's edge.
- W FIXED, and a decision of mine reversed: the code's format number went back to 1. I had bumped it to 2
  when `from` was added, and recorded under review 1 that an older Kosmos would then refuse a newer code
  "in generic words". There was no reason to pay that: an older Kosmos ignores `from` and joins as it
  always did, and this Kosmos refuses a code WITHOUT `from` with the old-code sentence either way.
  REJECTED: keeping 2 because no released build has the older parser yet (a staging build does).
- CONVENTION FIXED: the three refusal sentences live twice (the page shows its own copy). A test now reads
  the page and asserts each equals the engine's; it caught nothing today and would catch the next edit.
- NITs taken: "Turn on Kosmos+ remote access" was the wrong remedy for "not connected" (that state is not
  signed in; the existing note says "Sign in to Kosmos+ again in Settings"); the coordinator's sentence is
  now one printable line of at most 200 characters before it is shown.
- NITs not taken: `from` is an unsigned claim (stated under Weakest premise); the list includes this
  computer's own row; a refusal leaves an earlier snapshot for the same ref until it expires.
- Controls, on a scratch copy: without the `Error:` strip, without the guest-edge case, and with the
  page's sentence changed, the three tests that cover them go red, each by name. In the worktree: 140 pass
  across the four federation test files (still 140 after review 5).
- The full suite that passed at 3d5cba6b5 (12,528 tests) is about the head BEFORE this review and before
  a second merge of main. It does not cover this head. A new full run is owed.

## Review 5 (sonnet): 3 WARNINGs, 2 CONVENTIONs
- W FIXED: the other-account sentence ended "make a new code there", which loops in the likeliest real
  case (the two computers are signed in to different Kosmos+ accounts: a new code is refused the same
  way). It now says to check both are signed in to the same account first.
- W FIXED, and review 4's pass-through withdrawn: ANY coordinator refusal without a slash was shown, so
  "Kosmos+ said unknown mac." could reach the screen. Only one refusal has a way forward (this computer is
  itself still waiting to be allowed, kosmos#4681), and it is recognised by the coordinator's CODE
  (`own_lineage`, which the tunnel prints in the brackets), never by its words. It gets our own sentence.
  Everything else gets the general one, and the detail goes to the log.
  The shape is read from the tunnel's source (kosmos-relay crates/tunnel/src/coordinator.rs,
  `refusal_error`: `<sentence> (HTTP <n> on <path>, code <c>)`), not from a run against a coordinator that
  has #4681 (none is deployed). That code-in-the-line form arrives with the connector built from
  kosmos-relay#4665: an app whose connector is older prints no code, and a waiting computer there gets
  the general sentence. WEAKEST PREMISE: that this is an acceptable fallback for the builds in between.
- W FIXED: "your other computers" was still said for an owner project shared by own code before its seat
  is up, when a guest may be in the room too; and a project joined by own code sits in that same room.
  This computer cannot tell. Those rooms, and a record that cannot be read, now say "the other computers
  in this project", which is true with or without a guest. Review 4's seat-based split is gone.
- CONVENTIONs fixed: this plan's top part still said `v: 2` in two places; the browser-check README row.
- NITs taken: the no-address sentence named a switch where the state is "not signed in"; the test's
  refusals are named constants, not positions in a list.

## Review 6 (fable): 2 WARNINGs, 2 CONVENTIONs
- W FIXED: the waiting-computer matcher was anchored on "refused this Mac"; the Windows connector says
  "refused this computer" (the prefix is per platform; fedseats already accepts both for #4645). A Windows
  computer waiting to be allowed would have been told to try again. Both are matched; test line added.
- W FIXED: "Allow it from one of your other computers" named no control. The sentence now says where:
  Kosmos on the other computer shows that this computer is asking, with an Allow to press.
  WEAKEST PREMISE: that the other computer's card is recognisable as "this computer is asking". Its copy
  is PigeonPete's (#4702 board half).
- CONVENTIONs fixed: this plan's top part still said "your other computers"; Not covered now says that no
  shipped connector prints the code the matcher reads.
- NITs taken: a list that names no computer is "could not check", not "another account"; a dead `guest`
  role removed from the far-side test; the log line carries the card number.
- NITs not taken: a fixture `self` link carrying `edge_id`; the page-equality test would need escaping for
  a sentence with an apostrophe (none has one).

## Review 7 (opus): 2 WARNINGs, 4 CONVENTIONs
- W FIXED: a connector older than the account-computers route fails with "does not sign", which the
  general sentence answered with "Try again in a moment" for ever. It now says to update Kosmos on this
  computer (the wording fedseats already uses for the same cause). Test case added.
- W FIXED (coverage): the browser check asserted the refusal's text with the join form closed, so a hidden
  or overflowing sentence would pass. It now opens the join screen, and asserts the sentence is visible
  there and does not push the page sideways. NOT RUN YET: it needs a browser-check turn.
- CONVENTION FIXED: one derivation of "this account's computers". Verify now applies account-computers.js's
  address rule (one label under the coordinator's domain), so a row the "Your computers" menu would drop
  cannot make a code pass. Both fixtures that fake the coordinator now say which domain it is on.
- CONVENTIONs FIXED: two comments said the coordinator's sentence may be shown (none is, since review 5);
  this plan's top part called the refused code "a v: 1 code" in two places.
- NIT taken: a refused check forgets an earlier accepted check of the same room. Test, with a control.
- NITs not taken: `from` is an unsigned claim (Weakest premise); two older notes still say "the external
  project" for an owner room seated on a guest's edge after that edge ends (they predate this branch and
  are true of the guest); the "press Allow there" sentence depends on the waiting-computer card from
  kosmos-relay#4681 and the app's #4702, which are not merged either.

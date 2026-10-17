# macretired-6390: a computer already removed on the account page counts as retired when it removes itself

Card: kosmos#6390, the engine half.

## What changes
- `engine/remote.js forgetNow`: a retire refused because this computer was retired already (removed on the account
  page) counts as retired (`retired: true`, no "could not be updated" sentence). `retiredAlready` reads the coordinator's
  sentence ("this computer was retired", or the older "this Mac was retired") and only for a 401 on `/v1/mac/retire`.

## Decided
- Read the sentence, not the code: the coordinator keeps `mac_retired` off the wire (relay error.rs
  `the_code_is_not_exposed_to_the_caller`). Rejected: making the code public, and making the retire route answer
  "already retired" (both change the coordinator's auth path).
- Only forgetNow. The half-identity clear before a sign-in (clearHalfIdentity) is left as it is, and it is not right for
  an already-retired half identity: it reports the earlier sign-in as stranded and asks the person to remove it on the
  account page, which it already is. Noted on #6390 as its own fix (its tests pin today's sentence).
- Weakest premise: the match is on words across two repos. The relay pins the sentence on its side
  (`the_coordinators_retired_answer_is_final_here`, person_copy_4628.rs); nothing in this repo reads auth.rs. A
  rewording fails safe: the old "could not be updated" message comes back; nothing reads as retired that was not.
- A separate regex from engine/fedseats.js MAC_LEVEL_REFUSAL, which also matches other refusals (unknown mac, account
  gone); each names the other so a reword changes both.

## Not in this change (the card's second half)
- A removed state on the computer itself while its tunnel still serves, and the relay stopping a retired computer's
  tunnel promptly (relay serve.rs: a connected Mac keeps serving after it is retired, up to --max-tunnel-secs).

## Tests (engine/remote.test.js)
- A Forget whose retire is refused as already retired, in either wording ("this computer" and the older "this Mac"), and
  under the Windows build's prefix ("refused this computer", with a CRLF), reports retired with no failure sentence. CONTROLS, each still a failure said as one: a 401 on the retire route for
  another reason (no sentence), the retired sentence under a 403 (wrong status), the retired sentence for another route
  (wrong route), the sentence under a gateway's prefix (wrong prefix), and a plain 429. The match is one line-anchored regex: the tunnel's prefix, the sentence, the status
  and the route.

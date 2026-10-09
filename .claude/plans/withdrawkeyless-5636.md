# withdrawkeyless-5636: an unanswered post taken back with no key is recorded, so a new key never resends it

Follow-up to kosmos#5636 (found in review of #5662, recorded on the card). `kosmos community withdraw` refused a post
whose send got no answer when its agent had no key: "Kosmos no longer holds the registration that sent this post, so
it cannot take it back". But a new key is registered by a later sweep (sendPost's ensureRegistered, measured in the
test) or community call; settleUnconfirmed then finds no copy under the NEW account, settles the post as never sent,
and sends it again: a second public copy, after the agent was told it could not take the first back.

## Done looks like

Such a post is taken back (recorded in the deletes, so the sweep withholds it before any resend) and the answer,
`unconfirmed_keyless`, says it will not go again and that a copy that did arrive under the old account cannot be taken
down; both CLIs say it; a test proves the resend happens without the take-back and not with it.

## Decisions (reversible)

- Record it through requestDelete, the same record the person's Delete and every other take-back use; the sweep's
  send loop already withholds a post with a recorded delete before sendPost.
- A refused agent keeps its refusal (it never gets a key back, so nothing resends; and nothing it holds can reach the
  old copy). A SENT post with no key keeps its refusal (a new key is another account, which cannot take it down).
- New words, not the "unconfirmed" ones ("on its next send it takes it down if it did"), which a new account cannot do.
- Reverses #5574 review 3's refusal for this one case: its reason ("without a key nothing would ever find it") did not
  see the resend under a new key.
- Weakest premise: an older CLI talking to a newer board prints its generic "Kosmos recorded it. To see what happens
  ..., run: kosmos community status" for the new state, which is true but vaguer.
- Recorded, not changed: once the post is withheld, `community status` says "not sent: your person removed it before
  it went" (the withheld words), which is wrong about who for every agent take-back since #5574; a separate wording fix.

## Verification

- engine/communitywithdraw-5574.test.js 20/20: the review 3 test updated (sent and refused arms unchanged, the
  unanswered arm recorded); a new test with two keyless agents: the one not taken back IS resent once a new key is
  registered (CONTROL, measured), the one taken back is not. The fake backend gained /agents/me/posts (the settle needs
  it). Red by mutation (the new branch removed: 2 fail).
- cli.community-withdraw-5574.test.js: the Mac CLI prints the new words; the Windows CLI carries the same.
- Community suites, both CLIs' parity test, and the Windows and file-scanning guards.

## Review log

- **Round 1 (opus):** 0 blockers, 2 warnings, 3 NITs (both warnings measured by the reviewer with probes).
  - W1 fixed: a new key registered BEFORE the take-back (the record names the old registration) hit the knownOtherRegistration refusal and the next sweep resent the post. The take-back now covers an unanswered post whenever its sending registration is not the one held; review 4+6's test (which pinned the refusal) updated; a second scenario test covers it (red by mutation of the widened condition).
  - W2 fixed: the test never registered a key for the post taken back, so "not resent" held vacuously. Each agent now has an ordinary post too, so a sweep registers its new key; the test asserts the settle under ava's new key was reached (the fake backend records auth), the post ends withheld, and the CONTROL agent's is resent.
  - NIT 1 taken: `community status` says "taken back, so it will not be sent again. Kosmos never heard whether it arrived; if it did, that copy may still be up" (unconfirmed_taken_back) instead of promising to ask.
  - NIT 2 recorded: settleUnconfirmed can adopt a later identical repost's copy under a new registration (needs two unanswered sends with identical words); NIT 3 needs nothing (pessimistic only if the old key comes back).
- **Round 2 (sonnet):** 0 blockers, 2 warnings, 2 NITs.
  - W1 fixed: "may still be up" was shown with the sending key held, where the next sweep takes the copy down. unconfirmed_taken_back now needs agentKeyless or agentOtherRegistration (a new statusOf flag); with the key held the plain unconfirmed words stay. Tested both ways.
  - W2 fixed: a settle under a NEW registration ("not there") turned the record into "not sent" though a copy may have arrived under the old account. settleUnconfirmed keeps `unverified: true` in that case; status shows such a withheld post as unconfirmed_taken_back, and a repeat take-back answers unconfirmed_keyless, not "before it was sent" (red by mutation).
  - NIT 1 taken: the answer-only guard checks that every assignment of unconfirmed_keyless is inside withdrawFor. NIT 2 needs nothing.

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

(filled in per round)

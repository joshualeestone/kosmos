# cconfirm-8216: an unconfirmed community comment is looked for later (#8216)

## Done when
- A comment whose send got no answer, and which the community did store, is found on a later pass in its post's thread
  (or its parent's replies) by its community account and words, and settles as `sent` with its id, so status links to
  it and a take-back can reach it.
- One the community did not store stays `unconfirmed`, is never sent again, and status says Kosmos looked and has not
  found it.
- Pinned by tests against a fake community, each beside a control (another account's same words; a comment never
  stored), and red on main.

## Measured on main (a91e212a0f)
A comment with no usable answer to its POST is recorded `unconfirmed` (or stays `pending` with its write-ahead mark
after a board stopped mid-send) and is never sent again. Status said "Kosmos has no way to ask about a comment later,
so this will not change". An unconfirmed post is settled on a later pass by looking among the agent's own posts; no
such look existed for comments. The public community has no list of one agent's comments (a company space has one),
but it serves a post's thread newest first, and each comment carries its author's community id, words and time.

## Decision
`communitysend.settleUnconfirmedComments`, run each sweep after the take-downs and before the comment sends, whatever
the switch says:
- For each unconfirmed comment (state `unconfirmed`, or `pending` with `attempted` and not in flight), with a known
  sending account (`agentId` on the record, else the key's `remoteId`). The earliest it can have landed is ten minutes
  (clock skew) before `attemptedAt` (now recorded at the write-ahead and kept on `unconfirmed`), or, for a record an
  older board wrote, before the comment was made; with neither it is not settled by words alone.
- Match: same account id, same words (trimmed), not before that bound, and an id no other record already holds (so a
  copy already settled for another record, or found earlier in the same pass, is never claimed twice).
- Where it is looked for (anonymous reads, at most 12 per look): a top-level comment in the thread, newest first, up
  to 5 pages, stopping once a page reaches back before the bound; the oldest match on a page is taken, so two
  same-words copies pair in order. A reply in its parent's replies, read whole. A reply whose parent is itself a reply
  (the service keeps it under the top-level comment, and its replies route refuses a non-top-level id) in the replies
  of the top-level comment that holds the parent, found through the thread. A post gone (404 or 410) is complete.
- A company-space comment is looked for in the space's own list of the agent's comments (by post and words). That list
  is capped at 50 with no cursor, so a full list is never called complete.
- Found: `sent` with `remoteId`, `agentId`, `foundInThread`. Not found: `lookedAt`, `lookFirstAt`, `lookComplete`.
- At most once an hour per comment, for a week from the first look that got an answer (an outage does not use the
  week up), at most 3 per pass. The file is re-read before each write, so a send pass or a take-back in between is not
  overwritten, and the found id is checked against it once more.
- Status: `unconfirmed` (not looked yet), `unconfirmed_not_seen` (a complete look found nothing), `unconfirmed_stopped`
  (a week of looking), `unconfirmed_unasked` (no sending account held, or an address Kosmos does not send to; keys.json
  unreadable keeps the plain words). Each
  says never to send it again, and the "look for it under the post" line stays.

## Rejected
- A new "my comments" read on the community service: cleaner, but it needs a service change and a deploy before any
  board benefits; the thread read exists and posts already settle this way.
- Marking a comment not found as `not_sent`: a comment the community holds back is not in the public thread, so not
  seen is not not sent, and a resend could double it.

## Weakest part
A match by account and words. Two identical comments by one agent on one post are told apart only by time and by the
ids other records already hold. What would change it: the service returning a client-chosen id.

## Not done
- A comment past 5 pages of a busy thread is not found by that pass (`lookComplete` false; it is looked for again).
- The company-space branch has no test of its own (the fake has no space routes); it is reasoned from the space's
  list route.
- A company comment while that company's community is not this computer's is not looked for (status keeps the plain
  words).

## Review ledger (challenge loop)
- 1 (opus): a claimed id could be taken again (BLOCKER); records with no attemptedAt unbounded; replies to replies
  never found; the look ran before the take-downs; the unasked words; the company list's cap; tests missing. All fixed
  and tested except the company branch (reasoned).

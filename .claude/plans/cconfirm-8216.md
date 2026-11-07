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
`communitysend.settleUnconfirmedComments`, run each sweep right after the post settle, whatever the switch says:
- For each unconfirmed comment (state `unconfirmed`, or `pending` with `attempted` and not in flight), with a known
  sending account (`agentId` on the record, else the key's `remoteId`): read the thread anonymously, newest first, back
  to ten minutes before `attemptedAt` (now recorded at the write-ahead and kept on `unconfirmed`), at most 5 pages of 20;
  a reply is looked for in its parent's replies (oldest first, read to the end within the page cap). Match: same
  account id, same words (trimmed), not before the send.
- A company-space comment is looked for in the space's own list of the agent's comments (by post and words).
- Found: `sent` with `remoteId`, `agentId`, `foundInThread`. Not found: `lookedAt`, `lookFirstAt`, `lookComplete`.
- At most once an hour per comment, for a week from the first look, at most 3 per pass. The file is re-read before
  each write, so a send pass or a take-back in between is not overwritten.
- Status: `unconfirmed` (not looked yet), `unconfirmed_not_seen` (a complete look found nothing), `unconfirmed_stopped`
  (a week of looking), `unconfirmed_unasked` (no sending account known, or an address Kosmos does not send to). Each
  says never to send it again, and the "look for it under the post" line stays.

## Rejected
- A new "my comments" read on the community service: cleaner, but it needs a service change and a deploy before any
  board benefits; the thread read exists and posts already settle this way.
- Marking a comment not found as `not_sent`: a comment the community holds back is not in the public thread, so not
  seen is not not sent, and a resend could double it.

## Weakest part
A match by account and words: two identical comments by one agent on one post are told apart only by time (the look
takes the newest match not before the send). What would change it: the service returning a client-chosen id.

## Not done
- A comment past 5 pages of a busy thread is not found by that pass (`lookComplete` false; it is looked for again).

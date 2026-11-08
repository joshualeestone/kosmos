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
`communitysend.settleUnconfirmedComments`, run last in each sweep (after the take-downs, the comment sends and the
owner-link passes), whatever
the switch says:
- For each unconfirmed comment (state `unconfirmed`, or `pending` with `attempted` and not in flight), with a known
  sending account (`agentId` on the record, else the key's `remoteId`). The earliest it can have landed is ten minutes
  (clock skew) before `attemptedAt` (now recorded at the write-ahead and kept on `unconfirmed`), or, for a record an
  older board wrote, before the comment was made; with neither it is not settled by words alone.
- Match: same account id, same words (trimmed), not before that bound and (with `attemptedAt`) not more than an hour
  and ten minutes after it, and an id no other record already holds (so a
  copy already settled for another record, or found earlier in the same pass, is never claimed twice).
- Where it is looked for (anonymous reads, at most 12 per look): a top-level comment in the thread, newest first, up
  to 5 pages, stopping once a page reaches back before the bound; every match is collected and the oldest is taken,
  so two same-words copies pair in send order across pages. A reply in its parent's replies, read whole. A reply whose parent is itself a reply
  (the service keeps it under the top-level comment, and its replies route refuses a non-top-level id) in the replies
  of the top-level comment that holds the parent, found through the thread. A post gone (404 or 410) is complete.
- A company-space comment is looked for in the space's own list of the agent's comments (by post and words). That list
  is capped at 50 with no cursor, so a full list is never called complete. It carries no parent, so a same-words copy
  the agent wrote later on the same post could be taken for it (bounded by the send time and the claimed ids).
- Found: `sent` with `remoteId`, `agentId`, `foundAt`. Not found: `lookedAt`, `lookFirstAt`, `lookComplete`. A look
  that got no answer counts `lookFails`; after a week's worth the record is marked `unreachable`. A record the pass
  cannot look for (no store row, a company community not this computer's, a company comment sent by another
  registration, no time, a deleted agent) is marked `lookSkip`, so status does not promise a look.
- The write-ahead records the sending account (`agentId`), so a public look searches that account even after the
  agent re-registered (the thread read is anonymous).
- A page that fails is tried again later, never settled on what came before it; a read cut short by its budget, or by
  a cursor this cannot read, settles only on a sole match.
- At most once an hour per comment, for a week from the first look that got an answer (an outage does not use the
  week up), at most 3 per pass, oldest send first (so same-words copies pair in send order). A row whose time cannot
  be read never matches. The file is re-read before each write, so a send pass or a take-back in between is not
  overwritten, and the found id is checked against it once more.
- The board's row for an unconfirmed comment says Kosmos does not know yet and keeps looking (web/index.html, pinned by
  docs/browser-checks/render-community-delete-4313.js).
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
A match by account and words (and, for a reply, the top-level comment it sits under). Two identical comments by one
agent on one post are told apart only by time and by the ids other records already hold, so:
- a comment settled `sent` with no id holds none to exclude, and an unconfirmed same-words record tried within the
  window could take that copy;
- two unconfirmed same-words records with overlapping windows, one landed and one not, can pair the landed copy with
  the wrong record (send order makes the oldest record take the oldest copy);
- two same-words replies by one agent to different replies under one top-level comment cannot be told apart (the
  service names only who a reply answered).
- a record an older board wrote (no `attemptedAt`) has no upper time bound, so a later same-words comment by the same
  account on the same post could be taken for it.
None of these sends anything twice or claims another agent's comment. What would change it: the service returning a
client-chosen id with a comment.

## Not done
- A comment past 5 pages of a busy thread is not found by that pass (`lookComplete` false; it is looked for again).
  The same holds for a reply to a reply whose top-level comment is older than what one look reads: status keeps the
  plain words for the week.
- The company-space branch has no test of its own (the fake has no space routes); it is reasoned from the space's
  list route.
- A company comment while that company's community is not this computer's is not looked for (status keeps the plain
  words).
- A record an older board wrote carries no sending account, so it is looked for under the account held now; if the
  agent re-registered since, that look cannot find it, and status says "not found so far" for the week.
- "Once an hour" is at best: the look runs last in a sweep, so a slow pass before it delays it.

## Review ledger (challenge loop)
- 1 (opus): a claimed id could be taken again (BLOCKER); records with no attemptedAt unbounded; replies to replies
  never found; the look ran before the take-downs; the unasked words; the company list's cap; tests missing. All fixed
  and tested except the company branch (reasoned).
- 2 (sonnet): an unreadable time passed the bound; same-words copies paired by file order; the company list has no
  parent (written in the plan). Fixed.
- 3 (opus): no upper time bound; pairing held only within a page; the plain words promised a look for records never
  looked for; untested fixes; the take-back words said "never learned". Fixed and tested (pairing across pages, a claim
  landing mid-look, the upper bound, the status words), mutation checked. Not tested: the in-flight exclusion and the
  company branch (reasoned).
- 4 (sonnet): lookSkip was never cleared; a reply's parent was not checked; ambiguities undocumented; the deep
  reply-to-reply case silent. Fixed (parent_id checked, lookSkip cleared on a look) or written in Weakest part and
  Not done.
- 5 (opus): the sending account was not recorded; a partial read could settle; failed looks counted as looks; a deleted
  agent's record promised a look. Fixed and tested (re-registration, a failed page).
- 6 (sonnet): the unconfirmed record took the key's account after the POST instead of the write-ahead's. Fixed. The
  company branch stays reasoned (its test needs the company-policy harness); the older-board upper bound is written in
  Weakest part.
- 7 (opus): the board's comment row still said "never learned"; the failed-page test could not catch its rule; the
  fake's replies route ignored a taken-down post. Fixed (the row and its browser check, which CI runs; a sole match
  before a failed page, mutation checked; a reply on a gone post).
- 8 (sonnet): the look delayed new comment sends. Fixed (it runs after them). The no-id and company-parent findings
  repeat iterations 4 and 2 (written in Weakest part); the timezone one was checked against the service (its times
  carry a zone).
- 9 (opus): the board row and the take-back, edit and removal refusals promised a look where none would come; the busy
  reply-to-reply branch untested; a cut-short read could mis-pair two landed same-words copies; the look ran before
  the owner-link passes. Fixed: commentStillLooked decides the row's and refusals' words; a cut-short read settles on a
  sole match only with no same-words sibling waiting; the look runs last in the sweep. Tested (busy reply-to-reply, the
  per-pass cap, unreachable after a week of failed looks with the row and refusal words).
- 10 (sonnet): an older board's record after a re-registration reads as "not found" (written in Not done, with the
  hourly pace being at best). The same-words pairing (Weakest part), the look's place in the sweep (review 9) and the
  untested company branch repeat earlier findings.

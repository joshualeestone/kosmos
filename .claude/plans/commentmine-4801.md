# commentmine-4801: the owner sees, and can remove, the comments their agents published

Card: kosmos#4801. Board half only; the service route (`DELETE /posts/{post_id}/comments/{comment_id}`, agent bearer,
204, 404 for gone or not-own) is kosmos-community #24, merged. Was stacked on communitycomment-4373 (PR #4741); #4741 has merged, so
the base is now main at 84540d310.

## Call

- `GET /api/community/mine` returns `{ posts, comments }`. `communitymine.mineComments()` builds one row per comment
  the send layer has a record for (comments-sent.json) or the owner asked to remove (comment-deletes.json), joined
  to the board's stored comment row: `{ id, kind: 'comment', text, agent, postedAt, state, deleteRequested,
  deleteRetrying, agentRefused, untraceable, canDelete }`. No remote ids, no remote post id, no sentAt. Newest first.
  `text` is `communitysend.titleFor({ body })`: the first non-empty line, heading marks stripped, cut to TITLE_MAX
  (120 UTF-16 units), exactly as a post's title.
- Removals go through the same `POST /api/community/delete`. `requestDelete` looks the id up with `postMeta` first,
  then `communitystore.commentMeta` (service comments only). A comment id is written to `comment-deletes.json`, in
  the same folder as `deletes.json` (`dir()`, not the per-endpoint folder), and never to `deletes.json`.
- `sweepCommentDeletes(keys)` runs right after `sweepDeletes`, whatever the switch says. For each id in
  comment-deletes.json whose comments-sent record is `sent` with a `remoteId` and a `post`, it sends
  `DELETE /posts/{rec.post}/comments/{rec.remoteId}` as the agent (asAgent, so a stale token re-logs in once).
  204 or 404 settles it `deleted` (dropping deleteStatus); anything else keeps `deleteStatus` and is tried next sweep.
- `sweepComments` re-reads comment-deletes.json before each send (as the post pass re-reads deletes.json). A comment
  with a removal on record is settled `withheld` and never sent. Unreadable, the comment pass stops.
- canDelete for a comment: sent with a remoteId (`traceable`), or pending (never attempted), and no removal asked,
  and the agent not refused. Unconfirmed (attempted, no answer) and sent-with-no-id are `untraceable`: no Delete, and
  the row says why.
- Page: comment rows in the same `li.community-mine-row` list, merged with posts and sorted newest first on the
  client. Bold line `Comment: <text>`. Same Delete / "Delete it" / "Keep it" ask. Copy for posts-only lines widened
  to "posts and comments" (heading, empty line, could-not-read line, the switch's OFF note).

## Decided (beyond the brief)

1. **`untraceable` field on comment rows.** The page needs to tell "unconfirmed" from "sent but the service gave no
   id"; both have canDelete false. A boolean says only that Kosmos has no handle, not what the handle is, so the
   no-remote-ids rule holds. Rejected: deriving it in the page from state alone (cannot see the no-id case).
2. **requestDelete REFUSES an untraceable comment** (400 notEligible, plain-words reason) rather than recording it.
   Recorded, the row would say "Removing" forever, since the sweep has no id to send. A removal already on record
   from before is left alone (the sweep skips it).
3. **`commentRecords()` is a new export, `commentStatuses()` is unchanged.** /sent's comment shape is pinned by the
   4373 tests and read by the CLI; the owner's list needs deleteRequested, the withheld mapping and traceable.
   Rejected: widening commentStatuses (changes a shipped contract for no reader's gain).
4. **`mine()` keeps returning the posts array; `mineComments()` is separate.** The server composes `{ posts,
   comments }`. Keeps every existing communitymine test as it was.
5. **Rows come from records, not from every published comment.** A comment the sweep has not reached yet has no
   record and is not listed, exactly as posts behave (#4313). It is still removable through the API (withheld).
6. **willSend also requires comment-deletes.json to be readable**, since sweepComments now sends nothing while it is
   unreadable; otherwise the agent would be told "it goes on the next pass" and it would not.
7. **Comment wording says "Removed" / "Removing"** where a post says "Deleted" / "Deleting" (the brief: deleted rows
   say removed); the buttons keep the same Delete / Delete it / Keep it words as posts.
8. **The ask for a comment drops "It stays on this board."** A comment on a community post is never shown on the
   board's own site, so that sentence would be false for it.
9. **`not_sent` comment rows** (markNotSent: the agent was told it will not go) list as "Not sent. It stayed on this
   computer." with no Delete.
10. The 404 message for an unknown id is now "there is no such post or comment" (communitysend.test.js pin updated).
11. The switch check (render-community-switch-4288.js) pins the OFF note's text, so its regex moves with the copy.
12. **A sent comment records which service agent stored it (`agentId`, from keys.json's `remoteId`)**, and a removal
    is only asked, and only offered, while the board still holds that same registration. Found while writing the
    weakest premise below: keys.json's corrupt-file message says it may be "repaired or removed", and a removed
    keys.json registers the agent afresh as a NEW service agent. That agent's DELETE gets 404 ("not yours"), which
    sweepCommentDeletes would settle as removed while the comment is still public. Now such a comment is
    untraceable: no Delete, the row says Kosmos has no way to find it again, and the sweep never asks. A record
    with no agentId (none exist outside this unmerged stack) is treated as the current registration.

## Rejected

- Writing comment ids into deletes.json with a kind marker: sweepDeletes would need to learn about comments, and a
  missed branch sends `DELETE /posts/<comment id>`. A separate file cannot be misread.
- Holding a removal for an unconfirmed comment until "it might turn up": the service has no list of an agent's
  comments, so nothing would ever resolve it.
- Listing every published service comment (not only those with a record): would list comments from before the ON
  period that will never be sent, as if they were out.

## Weakest premise

That a 404 from `DELETE /posts/{post}/comments/{id}` means "gone". kosmos-community #24 answers 404 both for an
unknown comment and for one that is not this agent's. Kosmos asks only with the id the service answered and only as
the service agent that stored it (decision 12 closes the re-registration path). What would still break it: the
service changing a comment's id, or answering 404 for something other than gone or not-own (a proxy, a route
missing mid-deploy). A route missing mid-deploy would settle a removal as done while the comment stays up; post
deletes (sweepDeletes) take the same 404 the same way, so this does not make comments worse than posts. What would
change my mind: a service deploy path that serves 404 for the whole comments router.

## Verified

- Engine: engine/communitycommentmine-4801.test.js (16 tests), plus updated server.community-gate.test.js and the
  communitysend.test.js pin. All community test files: 335 tests, 333 pass, 0 fail, 2 skipped (the contract tests,
  KOSMOS_COMMUNITY_CONTRACT_URL unset).
- Red arms: each fix reverted on its own reds its test (separate file, sweep wiring, 404 settles, 5xx retries,
  withhold, canDelete, refusal of untraceable removals, the DELETE path, the send gate, willSend, no remote ids,
  /mine shape, the route deciding post vs comment, the same-registration guard in the sweep and in traceable), and the browser COMMENT arm reds when the page ignores comments.
- Browser: render-community-delete-4313.js (all passed, COMMENT arm included) and render-community-switch-4288.js
  (all passed) against a sandboxed board.

## Review round 1

- **W1 (a removal during the agent's first registration was sent).** `sendComment` re-reads comment-deletes.json
  after `ensureRegistered` and before the write-ahead; a listed comment is settled `withheld` and nothing is sent.
  Unreadable there, it sends nothing and leaves the record as it was (the next sweep's own read decides). Test: the
  fake `/agents/register` calls `requestDelete` before answering; no comment POST, state withheld, and still none on
  the next sweep.
- **W2 (a removal during an in-flight POST was refused as "never learned").** `commentRecords` reads
  attempted-but-unsettled as `sending` while this process has that POST out (an in-memory set, filled around the
  `asAgent` call), and as `unconfirmed` otherwise. `requestDelete` answers `busy` ("It is being sent right now; try
  again in a minute"), the route maps busy to 409, and the page says "Sending" with no Delete. Tests: engine state
  and refusal with the POST held open by the fake service; the route's 409 in server.community-gate.test.js.
- **W3 (where and when).** `mineComments` carries `remotePostId` (the post's id, public); the row's meta line links
  "on a community post" to `COMMUNITY_SITE + '/post/' + id` (only a plain id, target _blank, rel noopener
  noreferrer, exactly as the #4525 held list) and shows the date from `postedAt`. The comment's own service id
  stays out; the no-remote-ids tests now say exactly that. The COMMENT browser arm asserts the href and the date.
- **W4 (keys.json unreadable read as "a different registration").** `commentRecords.traceable` is `null` (unknown)
  when keys.json cannot be read; the row carries `traceUnknown`, has no Delete and says "Kosmos could not read its
  community registrations just now"; `requestDelete` answers `retryable` with that wording and the route maps it to
  503. Tests: engine row and refusal, and the route's 503.
- **NITs.** (a) comment-deletes.json's corrupt message says "repaired", never "removed". (b) communitymine.js names
  communitycommentmine-4801.test.js. (c) README row says "Delete shows where the board says canDelete"; the COMMENT
  arm asserts Keep it focus and focus to the heading after Delete it. (d) the unreadable comment-deletes.json test
  also shows posts still send, no DELETE goes out (with a control that sends it once repaired) and `requestDelete`
  answers an error. (e) a record with no agentId counts as this registration only when `keys[agent].registeredAt <=
  rec.sentAt` (both ISO); a key with no registeredAt does not. The fixtures that wrote sent records with no agentId
  and no keys.json now carry the agentId and key that sendComment and ensureRegistered write.

### Decided in round 1 (beyond the brief)

1. **`sending` lasts only while THIS process has the POST out.** The plain reading ("attempted but unsettled") would
   also cover a board that stopped mid-POST, whose mark nothing ever settles, so the row would say "Sending" and the
   removal "try again in a minute" forever. In memory, a restart reads it `unconfirmed`, as before. The send sweep
   and the delete route run in the same server process, so the set is the one both see. Rejected: an `attemptedAt`
   time window (a guess at how long a POST can take, and a clock to trust).
2. **W4's 503 applies only where traceability decides the answer** (a `sent` record). A pending comment's removal
   is a withhold, which needs no registration, so it is still taken with keys.json unreadable, and the row keeps its
   Delete.
3. **The date format** is the one Settings already uses for a date (the Claude sign-in's "good until" in the
   accounts list: month and day, plus the year when not this one), as a small `communityMineDate` helper beside the
   list; there was no shared helper to call. Rejected: `pjWhen` ("3 minutes ago"), which goes stale in a list that is
   painted once.
4. **Only comment rows get WHERE and WHEN.** Post rows are unchanged (the card's "where, when" is about comments).

### Weakest premise (round 1)

That the sweep and the delete route share one process, so the in-memory in-flight set is what the route sees. True
today (server.js runs `communitysend.sweep()` on its own timer). If the sweep ever moves to a worker process, a
comment mid-POST would read `unconfirmed` and its removal would be refused as "never learned", the pre-round-1
behaviour, not a wrong removal. Also: a legacy record (no agentId) sent in the same sweep that first registered its
agent compares a real-time `registeredAt` with the sweep-start `sentAt`, so it reads untraceable (no Delete) rather
than wrongly removable; only records from this unmerged stack lack agentId, and sendComment writes it whenever the
service answered `agent_id`.

## Review round 2

- **W1 (the held list said a sent comment "cannot be taken back").** The "Waiting for you" line for a comment on a
  public post now reads: "Releasing it while Community is on sends it to the public community. Once sent, it can be
  removed from the list below only if the community answered the send. Released while Community is off, it is never
  sent." Its code comment, and the comments at `communitysend.endOnPeriodNow` and the `communityblock.js` header,
  say the same. The agent-facing block text is unchanged: "do not send it again" is still true for the agent, which
  cannot take a comment back. render-community-held-4525.js asserts the new line and that "cannot be taken back" is
  gone. A repo-wide grep for "taken back" found no other claim about comments (the rest are about other things).
- **W2 (an unreadable comment record read as empty).** `commentRecords` returns null when comments-sent.json or
  comment-deletes.json cannot be read, `mineComments` returns null on that, and `/api/community/mine` serves
  `comments: null`. The page paints `#community-mine-comments-unread` ("Kosmos could not read your agents’ comments
  just now.") in place of comment rows, keeps the posts, and never shows the "none" line on that basis.
  `requestCommentDelete` refuses as `retryable` ("Kosmos could not read its record of sent comments just now", 503)
  when comments-sent.json cannot be read, since what happened to the comment is unknown. Tests: engine (null on
  each file, the refusal, nothing recorded), the route (comments: null, posts still a list, 503 with Retry-After),
  and the browser UNREAD arm (with no posts and with one).
- **NITs.** (a) The COMMENT arm dates c1 in THIS year (from the machine clock the browser shares) and asserts the
  month-and-day format, and adds c8 from 2019 asserting the with-year format, with a control that the two formats
  differ. (b) c9 (a post id that is not a plain id) and c10 (none) render no `a.community-mine-post`; c8 (plain)
  does. (c) The post link's `aria-label` is "The post this comment is on: <text>". (d) Base and counts updated here.
  (e) CLAUDE.md's Community routing row names `mineComments`, `comment-deletes.json` and `sweepCommentDeletes`
  (a plain tracked file; no generated or imported markers in it). (f) The retryable 503 carries `Retry-After: 60`.

### Decided in round 2 (beyond the brief)

1. **Any `comments` that is not a list is unknown on the page**, not only `null`: a missing field would otherwise
   paint a false "none". The browser fixtures that answered `{ posts }` alone now answer `comments: []` too.
2. **The removal refuses on unreadable comments-sent.json** (retryable 503) rather than recording. Recorded, an
   unconfirmed comment would read "Removing" forever, the case round 1 refused for a readable record.
3. **The year fixture uses the current year**, not a literal 2026, so the this-year arm does not turn red on
   1 January.

### Weakest premise (round 2)

That "only if the community answered the send" is the whole condition the owner needs before release. Removal also
needs the board to still hold the registration that sent it (a fresh registration reads untraceable). The held line
says "only if", which promises no more than is true, and the list below says why when a comment cannot be removed.

### Verified (round 2)

- engine/communitycommentmine-4801.test.js 21/21; server.community-gate.test.js 21/21. All engine/community*.test.js
  and server.community*.test.js (19 files): 272 tests, 270 pass, 0 fail, 2 skipped (the contract tests).
- Red arms: W2 engine arm red with commentRecords' null reverted (comments-sent.json arm) and, separately, with only
  the comment-deletes.json null reverted. NIT a red both ways: always month-and-day reds the other-year arm, always
  with-year reds the this-year arm.

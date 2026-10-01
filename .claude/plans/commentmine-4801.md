# commentmine-4801: the owner sees, and can remove, the comments their agents published

Card: kosmos#4801. Board half only; the service route (`DELETE /posts/{post_id}/comments/{comment_id}`, agent bearer,
204, 404 for gone or not-own) is kosmos-community #24, merged. Stacked on communitycomment-4373 (PR #4741), base
0eb8c375a.

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

# reviewernotice-6752 (kosmos#6752, the board half of kosmos#6594)

Every member sees, on their own Kosmos, when someone in their company or family is made a reviewer.

## What the coordinator already sends (relay #516, merged 2026-10-21 04:38 CDT, not yet deployed)
`POST /v1/mac/org/status` (full) carries `reviewerGrants`: the grants of the last 30 days, oldest first, removed ones
included, each `{ who (before the @), grantedAt, effectiveAt, state, removedAt }`, times in Unix seconds. Absent when
there are none.

## Changes
1. `engine/orgenroll.js`: `cleanReviewerGrants` keeps well-formed grants only (a name with control and
   direction-changing characters removed, at most 64 characters; positive whole-second times; no effectiveAt means in
   effect at once, as the coordinator's NULL rows are), the newest 20. The hourly `refreshNow` puts them on the
   enrollment record; an answer without the field drops the old list. The coordinator's `state` is not kept.
2. `server.js` `GET /api/org`: `reviewerGrants` to the screen only (the non-screen early return comes first), and only
   when there are some, so the not-joined shape is unchanged.
3. `web/index.html`: a list under the joined view's sentence in the Settings company block, hidden when empty, headed
   "Reviewers added to your company in the last 30 days:" (family words via plusOrgIn). Each line is text: "<who>,
   made a reviewer <when>, takes effect <when>." / "in effect since" / "removed". Pending or in effect is worked out
   from the times when the page paints, since the record can be an hour old.
4. `tools/family-e2e-6239.js`: the company consent hash pin moved to relay #516's words (51e783bb...), as that
   script's own comment asks.

## Decisions
1. **Where it shows: the Settings company block, as a standing list for 30 days, not a one-shot alert.** It is the one
   place the board already shows a member company facts from the coordinator, it is screen-only, and the coordinator
   already bounds the list to 30 days. Rejected: a one-shot note like stoppedFor (it needs a per-grant seen-set, and a
   note spent on a read the person did not look at is lost); a new board-wide banner (no such mechanism exists, and
   inventing one is a design decision bigger than this card). **Weakest premise: that a member opens Settings.** The
   card asks for "a screen they actually look at"; if that means the main board, this is the wrong place, and the
   change is to add a pointer there, which this list does not block.
2. Grants are kept only from the hourly full refresh. Other paths that write the record (a join, a settled join, a
   refused leave) write it without grants until the next refresh, at most an hour.
3. An older coordinator (no field) and a coordinator with none give the same thing: no list.

## Tests
`engine/reviewernotice-6752.test.js` (refresh keeps and drops the list; the cleaner), `web.reviewernotice-6752.test.js`
(line wording by times; the list paints as text, in family words, hidden when empty or not joined; the route sends to
the screen only). Mutation arms, each red: drop the record write, defeat the character strip, keep the oldest 20, trust
a stored state, list for a computer not joined, write markup, skip the paint call, send uncleaned grants.

## Not measured
The page against a real coordinator (relay #516 is not deployed yet), and how it looks (design shots owed).

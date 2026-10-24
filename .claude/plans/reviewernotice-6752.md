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
3. `web/index.html`: a block under the joined view's sentence in the Settings company block, hidden when empty: the
   heading "Reviewers added to your company in the last 30 days:" (family words via plusOrgIn), one sentence on what a
   reviewer can do in the coordinator's own consent words (a family's: a reviewer opens nothing), then one body-text
   line per grant, newest first, the name in its own `bdi`: "jordan, a reviewer since Oct 19", "sam.ortiz, becomes a
   reviewer Oct 22" (or "tomorrow at 3:46 AM" when it lands within a day), "alex, no longer a reviewer since Oct 20
   (made a reviewer Oct 19)". Pending or in effect is worked out from the times when the page paints, since the record
   can be an hour old, and anything older than 30 days is dropped there too.
4. `tools/family-e2e-6239.js`: the company consent hash pin moved to relay #516's words (51e783bb...), as that
   script's own comment asks.
5. `docs/browser-checks/mobile-shots.js`: a `plus-org-reviewers` screen for design shots.

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
4. **Review 1 (MAJOR on decision 1): kept, with the pointer filed as #6817.** Mona Lisa's design review agreed the
   placement is right for the standing record; a main-board pointer is a new surface on the main board and needs its own
   design call. #6817 also carries the relay-side fix review 1 found: the coordinator leaves the field out both for none
   and for a failed read, so one failed read hides the list for up to an hour on every member's board. The board cannot
   tell the two apart until the coordinator does.
5. **Review 1 minors and Mona Lisa's review, all taken:** the page filters to 30 days itself (a failed refresh keeps an
   old record); "no longer a reviewer", not "removed" (the coordinator's time is also set when a reviewer leaves on
   their own); a sentence on what a reviewer is (Mona Lisa's question 5: the product has one, relay #516's consent
   line); dates without year or time except a grant landing within a day; newest first; body-size lines, no bullets,
   4px apart, and the block's paragraph gap before Leave company; more invisible characters stripped (U+2028/2029,
   U+061C, U+FEFF, U+2060-2064, U+180E) and the name in a `bdi`. Not changed: relay-side list gaps (a reviewer
   promoted to admin drops out), on #6817.
6. **Review 2, taken:** today and tomorrow by calendar day (24 hours ahead on the spring-forward night is two days on);
   a grant removed while pending says "removed before it took effect"; the date check in the page test holds in any
   locale. Not changed: the route test checks, from the source, that the grants come after the not-the-screen early
   return. That catches the likely regression (the line moved above it); it does not drive the handler, and the
   engine test does not either, so a non-screen branch sending grants under another key would not be seen.
7. **Review 3: NITs only (converged).** Folded in: U+00AD, U+034F, U+FFF9-FFFB and the tag characters (U+E0000-E007F,
   with the regex's u flag) are stripped too. Not changed: a Settings pane left open across a grant's effective moment
   keeps its wording until the next repaint (reopening Settings repaints).

## Tests
`engine/reviewernotice-6752.test.js` (refresh keeps and drops the list; the cleaner), `web.reviewernotice-6752.test.js`
(line wording by times; the list paints as text, in family words, hidden when empty or not joined; the route sends to
the screen only). Mutation arms, each red: drop the record write, defeat the character strip, keep the oldest 20, trust
a stored state, list for a computer not joined, write markup, skip the paint call, send uncleaned grants. Round 2
(after review 1 and the design review), 14 arms, all red: stored state, the within-a-day time, not joined, the 30-day
filter, newest first, bdi, markup, body text, the paint call, family words, the record write, newest 20, the invisible
characters, uncleaned grants.

## Not measured
The page against a real coordinator (relay #516 is not deployed yet). The e2e hash pin (change 4) cannot discriminate
until it is: the live coordinator still serves the old words. The "light" design shots of this block render dark, on
main's plus-org-joined screen too (not from this change; cause not found).

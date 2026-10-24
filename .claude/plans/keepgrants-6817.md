# keepgrants-6817 (kosmos#6817 item 2, the board half)

Stacked on reviewernotice-6752 (PR #6825). kosmos-relay #542 (merged, not yet deployed) makes the coordinator send
`reviewerGrants: []` for none and leave the field out only when it could not read the grants. The board now tells the
two apart.

## Change
- `engine/orgenroll.js` refresh: the field present (a list, empty or not) replaces the list and records when it was
  confirmed (`reviewerGrantsAt`, epoch ms); the field absent keeps the list this record had, for the same world and
  company, with its old time. Another company on the answer starts with none.
- `server.js` `/api/org`: passes `reviewerGrantsAt` with the list (screen only, as the list).
- `web/index.html`: when the list was last confirmed over a day ago, the heading says so: "Reviewers added to your
  company in the last 30 days (last confirmed Oct 18):" (Mona Lisa's design; the "what a reviewer is" sentence moves
  above the heading so the heading sits directly over its list). The page's 30-day filter on each grant is the expiry.

## Decisions
1. **A day before the line shows.** The board reads hourly; one or two failed reads are noise, a day of them is worth
   saying. Weakest premise: a whole day of a stale list without a word.
2. **No separate expiry of the kept list.** Grants past 30 days drop at paint, so a kept list empties itself within 30
   days of its newest grant. Rejected: dropping the list after N failed reads (it would hide a pending grant exactly
   when the coordinator is struggling).
3. A coordinator from before relay #542 sends no field when there are none, which now reads as "could not read": a
   list from such a coordinator would be kept. None exists: the field and #542 deploy together (relay #516 and #542 are
   both undeployed).

4. **Review 1, taken:** a review's Accept (re-accepting changed words) keeps the list and its time for the same
   company, so a failed read after it still has one to keep; a list is kept only with a confirmed time (one without
   came from before "absent" meant "unread"); the test back-dates the time so "kept" cannot pass by sharing a
   millisecond with "refreshed"; the line reads "...this list on Oct 19." Not changed: the world half of the keep rule
   has no arm of its own (a record for another world is cleared earlier in refresh).

5. **Review 2, recorded:** two rare rebuilds (a join whose outcome was unknown being settled, and an undo whose record
   was gone) write a fresh record without the list. Not carried: both are rare, a later failed read is rarer still,
   and the next successful hourly read restores the list; carrying it would add the four-part check to two delicate
   paths for that. A coordinator sending a non-empty list that cleans to nothing clears the list (garbage is treated
   as "none", not "unread"): clearing is the safe direction for a screen that warns.

6. **Review 3:** the `plus-org-reviewers` design shot now carries a list last confirmed three days ago, so the age
   line is in the shots for design review. Recorded, not changed: a review's Accept on its timeout branch keeps the old
   list even if that answer carries a fresh one (honest, with its old time, until the next hourly read); a clock that
   ran ahead delays the line; the route's time is checked by a source match, as the file's other route checks are.

7. **Mona Lisa's design look, taken:** the date folds into the heading instead of its own line, and the sentence on
   what a reviewer is goes first, so the heading's colon is straight above the list. Review 4 (on the earlier line):
   NITs only. Recorded: the design shot's list cannot be real (a pending grant with a confirmation over a day old);
   a real list shows one or the other.

8. **Review 5: NITs only (converged).** Recorded: the date has no year (grants past 30 days drop, so it is always
   recent); a record from the #6752 build with a list but no time paints as fresh for at most the hour until the next
   read replaces it.

## Tests (each proven red by a mutation)
`engine/reviewernotice-6752.test.js` (absent keeps list and time, [] clears, another company starts empty) and
`web.reviewernotice-6752.test.js` (the age line only past a day; the route passes the time). Arms, all red: absent
drops; any company keeps; kept time refreshed; [] keeps; always stale; route drops the time.

## Not measured
Against a real coordinator (relay #516 and #542 not deployed).

# keepgrants-6817 (kosmos#6817 item 2, the board half)

Stacked on reviewernotice-6752 (PR #6825). kosmos-relay #542 (merged, not yet deployed) makes the coordinator send
`reviewerGrants: []` for none and leave the field out only when it could not read the grants. The board now tells the
two apart.

## Change
- `engine/orgenroll.js` refresh: the field present (a list, empty or not) replaces the list and records when it was
  confirmed (`reviewerGrantsAt`, epoch ms); the field absent keeps the list this record had, for the same world and
  company, with its old time. Another company on the answer starts with none.
- `server.js` `/api/org`: passes `reviewerGrantsAt` with the list (screen only, as the list).
- `web/index.html`: a line, "Kosmos last confirmed this list <date>.", shown only when the list was last confirmed over
  a day ago. The page's 30-day filter on each grant is the expiry.

## Decisions
1. **A day before the line shows.** The board reads hourly; one or two failed reads are noise, a day of them is worth
   saying. Weakest premise: a whole day of a stale list without a word.
2. **No separate expiry of the kept list.** Grants past 30 days drop at paint, so a kept list empties itself within 30
   days of its newest grant. Rejected: dropping the list after N failed reads (it would hide a pending grant exactly
   when the coordinator is struggling).
3. A coordinator from before relay #542 sends no field when there are none, which now reads as "could not read": a
   list from such a coordinator would be kept. None exists: the field and #542 deploy together (relay #516 and #542 are
   both undeployed).

## Tests (each proven red by a mutation)
`engine/reviewernotice-6752.test.js` (absent keeps list and time, [] clears, another company starts empty) and
`web.reviewernotice-6752.test.js` (the age line only past a day; the route passes the time). Arms, all red: absent
drops; any company keeps; kept time refreshed; [] keeps; always stale; route drops the time.

## Not measured
Against a real coordinator (relay #516 and #542 not deployed).

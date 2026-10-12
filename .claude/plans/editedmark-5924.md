# editedmark-5924: community read shows that a post or comment was edited

Card: #5924 (follow-up from #5574).

## Done when
A post or comment whose `edited_at` is set shows `, edited <YYYY-MM-DD>` on its header line in
`kosmos community read` (feed, `--post` and its comments/replies, the `--replies` digest and its
owed-person section). Nothing is shown when `edited_at` is null, malformed, or on a tombstone.
A test fails if the marker is dropped (proved red by stubbing the marker out).

## Approach
- `engine/communityread.js`: `editedOf()` re-shapes the service's `edited_at` to a date (same
  shape as `at`), only from a well-formed ISO timestamp, because the header sits outside the
  quoting. `editedNote()` renders it. `itemOf` and `commentOf` carry `edited`.
- Following feed replies (communityfollow) are built by another module and are out of scope.

## Rejected
- Showing the time as well as the date: `at` is date-only on every header; matching it keeps
  one shape. The web page shows the full time for anyone who needs it.

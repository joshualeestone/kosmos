# roomcopy2-8769: Baron's three #8776 follow-ups to the busy room copy (kosmos#8769 item 4)

Source: Baron Draxum's comment 7030150500 on #8769 (22:1x CST 11-19), read in main's install/kosmos cmd_room. Taken by
Angel on Splinter's routing (01:44 CST 11-20). Each was checked with a test before changing anything; all three were real.

## Finished means
1. A busy refusal from the HEALTH CHECK (before the read) shows the kept copy, as a read that times out after it does.
2. The header and the copy are on stderr in both CLIs: stdout is empty when a copy is shown.
3. A 401, 403, or a 404 to the room (any read but by post id) deletes the kept copy; a 5xx keeps it.
4. Tests for each that fail on main's CLIs and pass here, with controls (5xx keeps; not running shows none; by-id 404 keeps).

## Design
- The copy logic moves from cmd_room into `_room_busy_copy`, called from both busy paths; the key is worked out before
  the health check (require_valid_project_id moves with it).
- Rejected: keeping the header on stdout (#8776 review 1). A stdout-only script then reads an old room; exit 1 alone
  does not protect a pipe that ignores it. stderr is still one stream with the header first.
- The Windows CLI has no health check before its room read, so follow-up 1 has no twin there.

## Weakest premise
That no caller reads `kosmos room` stdout on a busy board expecting the copy. Searched: no product caller does; the
4466 busy test holds no copy and still passes.

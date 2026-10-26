# kosmos#7225: nightly full browser-check run red on main (render-roomfree-6949)

## Finding (measured 13:4x 10-26)
- Nightly 40357022432 at 1ecd143444: render-roomfree-6949 failed every arm, both tries. No 🙋 pill rendered at all
  (`pills: 0`), so the click on it timed out. Deterministic, not runner noise.
- Cause: #7185 (taskchatid-7185, merged 10-26 morning). engine/messages.js now gives no reader a room row stamped
  before its project's createdAt (an earlier project of that name). The check creates its project NOW, then writes
  reactions dated three hours back, so every reaction was filtered out. The product is right (a reaction cannot
  predate its project); the fixture became impossible. #7185 fixed seven tests the same way ("date the project
  back"); its sweep missed the browser checks.
- Same class, silent: docs/browser-checks/mobile-shots.js seeds the sample room with rows 30 minutes old after making
  the project, so every room design shot since #7185 shows an empty room ("Nothing here yet"). Measured: the
  project-room shot from origin/main is empty, and with the project dated back it shows the posts and reactions.
  NOT fixed here: see "Split out" (#7233).

## Change
render-roomfree-6949 dates its project back to just before its claims (four hours) before writing them, as #7185's
tests date theirs. Only that check: it is what the 0.7.70 cut waits on.

## Split out (review round 2)
mobile-shots.js has the same defect (its sample room is seeded 30 minutes back, so room shots come out empty since
#7185), but its seed is shared by every screen and createdAt also decides a project's "new" state (roomLive, the
file-created slack). Dating it back changes more than the room, and that needs every shot re-measured. It is a
#7233, not this cut's blocker.

## Rejected
- Dating the rows to now: the check's age arm needs "claimed 3 hours ago", and the shots' sample room needs its times.
- Changing the filter: it is #7185's correct fix.

## Weakest premise
That no other check writes room rows stamped BEFORE their project's createdAt. Writers that append to the message log
directly, checked in review round 1 (14:02): render-roomfree-6949 (fixed here); mobile-shots' sample room, refused line and held lines (#7233, not fixed here);
and
render-projects.js:516-527 (stamped with new Date() after the project exists). Rows stamped at or after project
creation are unaffected.

## Review round 1 (sonnet) points, measured rather than reasoned
- Dating the project back after its threads exist could make a thread stamped with the old createdAt refuse (chat
  readThread compares projectBornAt). Measured: render-roomfree-6949 passes 48/48 with the fix (and again after
  the date was narrowed to four hours). The design-shot comparison made then belongs to the mobile-shots change,
  which is now #7233.

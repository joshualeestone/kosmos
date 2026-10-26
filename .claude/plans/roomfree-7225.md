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
  the project, so every room design shot since #7185 showed an empty room ("Nothing here yet"). Measured: the
  project-room shot from origin/main is empty; from this branch it shows the posts and reactions.

## Change
Both date the project back (createdAt 2020-01-01) before writing the rows, as #7185's tests do.

## Rejected
- Dating the rows to now: the check's age arm needs "claimed 3 hours ago", and the shots' sample room needs its times.
- Changing the filter: it is #7185's correct fix.

## Weakest premise
That no other browser check writes back-dated room rows. Measured: only these two files append to the message log
directly. A check that seeds through a route stamps "now" and is not affected.

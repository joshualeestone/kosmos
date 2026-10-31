# avcache-7677: agent avatars cached on the iPhone, drawn at once, refreshed about once a day

Card: kosmos#7677 (Josh 10-31 08:34: "cache the agent avatars somehow and only refresh them so often. They take a while to
load"; build 24's Agents tab showed letter placeholders on every row).

## Today
BoardClient keeps agent pictures in memory only (`pictures`, `pictureVersions`), so every launch starts with letters and
fetches each picture one at a time after the first agents read. The board already sends each agent's `avatarVer`.

## Finished looks like
- Each agent's picture is kept on disk per computer, in the app's caches folder (`Environment.avatars`, a folder of their
  own in LogicTests): the image, its avatarVer and when it was fetched.
- On the first agents list read from a computer in a run, its cached pictures are loaded before that list is shown, so
  rows seen before draw their portrait at once.
- A picture is fetched only when the agent's avatarVer differs from the cached one, there is no cached one, or the cached
  one is a day old or older (`Board.avatarNeedsFetch`). A fetched picture replaces the cached one on disk.
- A computer that answers 404 for an agent (no picture) drops that agent's cached picture.
- Signing out removes the cached pictures; switching computers loads that computer's.
- LogicTests: `Board.avatarNeedsFetch` on each side of each boundary; BoardClient with a fake Mac and a temporary cache
  folder: a second client (a relaunch) shows the cached picture before any picture request, asks nothing when the version
  is unchanged and the copy is fresh, asks once a day, and asks when the version changed.
- Simulator shots: a cold relaunch with the picture route slowed shows portraits at once; the control with a changed
  avatar shows the new one after the refresh. Then needs-device for Josh's look.

## Decided
- Caches folder, not Application Support: iOS may purge it under storage pressure, and then the app only fetches again,
  which is the behaviour today. Rejected: Application Support (would keep pictures the person never sees again).
- Keyed by the computer's address, as the in-memory pictures are cleared on a computer switch (an agent of the same name
  on another computer is another picture).
- Weakest premise: that avatarVer changes whenever the picture does. The daily refresh is the backstop if it does not.

## Review round 1 (10-31, general-purpose reviewer): no BLOCKER, four warnings, all fixed in 0481e9a34d
- W1: a picture of an agent not listed, or listed with hasAvatar false, now goes from memory and the kept folder after each
  list read (skipped when the list is unchanged). Before, it came back from disk on every launch.
- W2: forget() (another account, and a sign-out through accountChanged) deletes the kept folder.
- W3: the no-session branch no longer deletes it: that branch also means "Keychain not readable yet".
- W4: tests that can fail. Control run: the code before this fix fails exactly the 4 new behaviour checks (drop, gone from
  disk, Keychain miss keeps, sign-out deletes); after it, 1778/1778.
- NITs left: disk work on the main thread (about 20 small files, once per computer per run); a non-image file is kept
  for a day (skipped only when empty); folder names can collide for host:8080 vs host_8080 (not real addresses); test
  folders now removed by the tests that make them.

## Review round 2 (10-31): no BLOCKER, one warning, fixed
- W1 fixed: a picture answer is taken only if the agent is still listed with a picture at the same version, so a request
  out while the Mac dropped the picture cannot bring it back past the prune memo. Not covered by a test: the fake world
  answers at once, so a list change mid-request cannot be staged. Named, reasoned from the code.
- NIT fixed: no prune on an empty list (a board just restarted can answer one). A hasAvatar flip while a pane is untied
  can still drop kept files; the cost is one re-fetch.
- NIT fixed: boardLoopTests removes its whole picture folder when it ends (the round-1 line above was wider than the code).
- Left: session names outside PushBridge.isAgentSession (lowercase, digits, - and _) are not kept on disk, so those agents
  fetch as before; a killed atomic write's temp file is not pruned (caches folder, removed on sign-out).

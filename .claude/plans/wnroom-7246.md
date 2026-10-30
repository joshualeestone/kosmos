# wnroom-7246: a What's New pool item for addressed-only room delivery (kosmos#7615 item 3, from #7246)

## Why
Josh's 0.7.75 report (#7615 item 3): #7246 slice 2 (PR #7398) made an agent's room post reach only the members it
names, and no release note said so. Three seats' "ready" replies reaching only the coordinator read as a fault.
Release notes are pool items in release/whats-new-pool.json (engine/releasenotes.js, tools/whats-new-pool.js);
their words are set by whoever wrote the fix (Renet, m1756).

## The item
- Title "Room posts wake only who they name"; line at most 140 characters (the window's limit, enforced by the build).
- `since: "0.7.73"`: the earliest release tag holding slice 2 is archive/0.7.73-app-commit (Renet measured; I checked
  3d11bda666 is its ancestor). No 0.7.72 tag exists to check against, so if 0.7.72 carried it the note is one release
  late, which is the harmless direction.
- `status: "pending"`, `rank: 14.5` (Baron's ranking, m1766): it leads 0.7.76's list.
- No `restart`: delivery is the board's, so running agents get it without restarting.

## Checks
- `node tools/whats-new-pool.js build --offline 0.7.76` accepts the pool and leads with the item.
- engine/releasenotes, engine/whatsnew, tools.release-gate, tools.whats-new-pool-5711 and -sync-5713 tests pass.
- After merge: Baron rebuilds 0.7.76's list on his own branch.

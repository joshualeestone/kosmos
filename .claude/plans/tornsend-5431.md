# #5431: a crash-torn sent.json paused community sending with no end

**Branch:** `tornsend-5431` · **Card:** kosmos#5431 (found on the Windows orchestrator box, 0.7.22)

## The defect

`saveJson` wrote a temp file and renamed it into place with no fsync. After a crash NTFS kept `sent.json` at its
full length with zeroed contents (3 NUL bytes, the torn `{}\n`). `loadJson` rightly cannot read it, so every sweep
returned `skipped: 'unreadable'` from 2026-10-01 on, while status told the agent to "look again shortly".

## The fix

1. `saveJson` flushes the temp file (fsync) before the rename, and the folder after it where the system allows
   (Windows cannot flush a folder: the call fails and is ignored; there the rename is what NTFS journals). A
   failed write removes its temp file.
2. `repairTornRecords`, run at the start of every exclusive section (before the pending retirements land): a
   `sent.json` or `comments-sent.json` that is empty or only NUL bytes is reset to `{}` when this service's
   `keys.json` holds no agent at all (missing, or an empty object). With no key nothing can have been posted or
   commented, so `{}` is the truth and nothing is sent twice. It runs inside the exclusive section, so no other
   writer in the board races it.
3. `kosmos community status` no longer says "look again shortly" for an unreadable record; it says to tell the
   person if it stays, and that the board's log names the record.

## Decided, not missed

- Never reset `keys.json`, torn or not: that would give every agent a second public name. A torn `keys.json`, or a
  torn `sent.json` once any agent has a key, stays paused for a person, as before.
- Only empty or all-NUL counts as torn. Any other unreadable content (`{ not json`) is still left for repair; the
  existing test "an unreadable sent, keys or deletes file pauses sending and is left for repair, never reset" holds.
- The card's ask 3 (the post-time answer "not sending right now" when the switch is on) needs a reason from
  `willSend` through both routes and both CLIs: filed as #5435 rather than widening this change.
- The class: 80 of the 84 files in `engine/` and `server.js` that rename into place had no fsync at origin/main. Filed as #5434 (one shared helper), not
  done here.
- Not done: surfacing a torn record on the owner's page (card ask 2b). The status line and the log now say it;
  a page banner is #5434's per-store decision.

## Verification

- engine/communitysend.test.js: four #5431 tests (repair with no keys, for sent.json at 3 and 0 bytes and for
  comments-sent.json; no reset once a key exists, including a keys.json holding only a retired account; never
  reset keys.json; every record flushed before its rename).
- Mutations, each red: the repair call removed; the keys check removed; the fsync removed; an unreadable keys.json
  read as empty. Every community test file: 613 pass, 0 fail (the 2 skips are the contract tests, no URL set).

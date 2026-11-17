# kosmos#8652: the first message to a just-started Windows agent is refused as missing

## Finished looks like
On Windows, a first message to an agent that was just created or restored is delivered (after a short wait for its
roster row) or refused with "still starting, nothing was sent"; a name that is really missing is still refused
"no agent by that name" at once.

## Cause (read in the code, design notes in ~/.cache/claude-handoffs/angel-8652-design.md)
- The DM send's gate (`knownAgent`, server.js) reads the pane roster only.
- On Windows a roster row needs the session live in `claude agents --json`; that lists a new session about 5 s
  after its ownership record row (win32create.js awaitSession), and the read is cached (win32roster.cachedRun,
  stale answers up to 30 s served while a background read runs). Nothing refreshes it after a create or restore.
- So for a few seconds a starting agent reads as unknown and the send answers 404.

## Change
1. `win32roster.makeCachedRun`: `refreshAsync()`, a background read that resolves when it lands (joins one in
   flight), so a waiter never blocks the board's thread. The stale path uses the same `kick`.
2. server.js: `startingAgent(name)`: no card holds the name, the worker folder exists, not removed, and a record row
   under the name written in the last 60 s. `awaitRosterRow(name)`: up to 8 s (the iPhone allows a request 15 s), 1 s steps, a fresh read raced against the time left, then re-check.
3. DM POST gate: a starting agent is waited for; if the row never shows, 409 `because: 'starting'` with
   "NAME is still starting, so nothing was sent. Try again in a moment." 409 not 503, because the page and the
   iPhone read a 5xx on a send as "may have gone".

## Rejected
- (b) a "starting" card state: a new engine state with every coupling site, and it does not stop a caller that
  sends without reading the card. Possible follow-up.
- Forgetting the cache after create/restore: a sync re-read blocks the board (230 ms to seconds), and the ~5 s
  registration lag remains anyway.
- `/api/msg` (agent to agent) has the same race but answers 200 could_not, not 404; left for a follow-up card.

## Weakest premise
That the gap is registration lag plus cache age, i.e. the session becomes live within ~8 s. If a restore
sometimes never reaches the live list, the send now ends in 409 instead of 404: more honest, still not delivered.

## Tests
- server.dm-starting-8652.test.js: row appears 300 ms later (200); the Windows roster (win32roster.make) found by the fresh read, with a control without it (409); a slow read cannot stretch the bound; never appears (409, bounded); missing name,
  old record row, removed agent, stranger's pane (404, no wait); control with the wait off (not reached).
  Against the unchanged server.js the two starting arms fail and the rest pass.
- engine/win32roster.cached.test.js: refreshAsync resolves on landing, shares one read, keeps a failure, survives a
  throwing reader.
- Focused run of 33 files (DM routes, every win32roster reader, fixture/brand/name/reachable/separator guards):
  750 tests, 0 fail.

## Review notes
- Iteration 1: the wait could overrun on a slow roster read (fixed: raced against the time left, 8 s); the Windows
  roster path is now driven end to end in the test through win32roster.make, with a control that fails without the
  fresh read; visibility is gated on time, not on a read count.
- Not changed: a mis-cased name while starting still 404s (the record match is exact, as before); a failed forced
  read is kept as a failure in the cache, as the stale path already did, and the roster's 15 s hold covers it.

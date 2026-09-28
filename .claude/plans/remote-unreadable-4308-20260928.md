# #4308: an unreadable remote-access settings file (Sonya Blade, 2026-09-28)

## Ruling (Liu Kang, on the card)
An unreadable settings file is NOT permission for a signed call. Instead: stop the state happening (atomic
writes, tested), and make it visible locally (a message on the board; turning remote access on repairs it).

## Finished means
1. An interrupted write cannot produce an unreadable file: the previous file stays whole (test).
2. A damaged file shows "Your remote-access settings could not be read. Turn Kosmos Plus on again to repair
   them." on the Plus pane of a real board, and turning remote access on rewrites it.
3. No signed call goes out while the file is unreadable (test, with a control that does call).

## What already existed
- `write()` already went through `remote.json.tmp` plus a rename, so a crash mid-write left the old file.
  Gaps: no fsync before the rename (a power cut could leave the renamed file empty, which is the
  "cut short" state), and a FIXED temporary name (two writers could interleave into one temporary file).
- `mac-standing.fetchStanding()` already gates on `read().on`, which is false for an unreadable file, so no
  signed call went out. Now pinned by a test.
- `GET /api/remote` already returned `ok: false`, and the engine's status sentence already said "your
  remote-access settings could not be read" (measured on a sandboxed board), which the old page showed under an
  "Off" switch. What was missing: how to repair it, and any guarantee it would still be there to read, because a
  background write rebuilt the file as off within minutes and the sentence went with it.

## Decisions
- **write(): unique temporary name, fsync, rename, best-effort directory fsync, temporary removed on failure.**
- **Only a person's own action repairs a damaged file.** `write()` rebuilds from `read()`, and `read()` of a
  damaged file is the defaults with on:false, so any background write (standing cache, device-id mint, denied
  list) would silently rewrite it as off within minutes, and the page message would never be seen. Person paths
  pass `{ repair: true }`: the switch (setOn), setRelay, sign-in (email, register's off, turn on after sign-in),
  Forget. Background writes return `{ ok:false, unreadable:true }` and leave the file.
  Rejected: letting any write repair (erases the error before the person sees it); refusing all writes
  including the switch (then nothing can repair it).
- **The repair instruction has one source: the engine's status() sentence.** The page already shows that
  sentence under the switch (paintPlus), so the change is in engine/remote.js only and web/index.html is untouched.
  An earlier cut set the text on the page as well, which was a second copy of one fact (convention #5; review
  iteration 2). It shows on the enrolled pane only: enrollment is the state dir, not this file.
- **A refused device whose note cannot be saved says so** on stderr (deviceDeny), instead of dropping it silently;
  the coordinator has the answer either way (review iteration 2).
- **A repaired file starts from defaults:** the relay override and email in the damaged file are gone (they
  could not be read). The device id is the exception: if this process already minted one for a sign-in, the repair
  keeps it, so a sign-in on a damaged file does not produce a second "this computer" (review iteration 1).
- **Stale temporary files** (a write killed between open and rename) are removed after a successful save only if
  their writer is gone (the pid is in the name; `kill(pid, 0)`) AND they are older than ten minutes. A still-running
  writer keeps its file however old it is (review iteration 2).
- **fsync on macOS** hands the bytes to the disk but does not flush the drive's own cache (F_FULLFSYNC, which Node
  does not expose). The comment says so rather than promising more.

## Weakest part
If `read()` fails for a reason other than damaged contents (remote.json replaced by a directory, a folder that
refuses access), the page still says turning remote access on repairs it, and the switch then answers "we could not
save that setting". Rare; left as is, and the switch's own error still says what happened.

The repair list is a judgement about which callers are "a person". setupStart's email write and register's
off-on-failure are inside a person's sign-in, so they repair; the denied-device list is a person's action too
but is not about this setting, so it stays non-repairing and fails with "could not be read" until the switch
repairs the file.

## Checks
- engine/remote-unreadable-4308.test.js: 8 tests. The ones that carry the change are 1c (fsync before the rename),
  2 (a background write leaves the damage), 5 (the device id survives a repair) and 6 (stale temporaries swept).
  1a and 1b pin that an interrupted write leaves the old file whole: that already held, and on the old code they
  fail only on the leftover-temporary check and on writeFileSync bypassing the patched writeSync. 3 (the switch
  repairs) and 4 (no signed call, with a control that does call) pin behaviour that already held.
- Real board (sandboxed data, this branch, fake tunnel): a damaged remote.json on an enrolled Mac shows the repair
  message on the Plus pane under an Off switch; turning remote access on rewrote it as valid settings, the message
  went, and no temporary file was left.
- web.remote-unreadable-4308.test.js: 3 tests, end to end: a real damaged remote.json in a sandbox, the real
  status() it produces, paintPlus run on that answer. The message test fails on the engine sentence before this
  change.
- engine/remote.test.js: the #3827 save-failure fixture planted a directory at the fixed temporary name; it now
  refuses to open a temporary file for remote.json instead. 101/101.

# cloudlock-7285 challenge review 2 (blind, CTO lens)

Reviewed: 4b9454d04c55fa182279383c3cc68bdd7a9e03a0
Counts: 0 BLOCKER, 1 WARNING, 2 NIT

## Findings

### [WARNING] engine/remote.js:1084: the repair rewrites an UNREADABLE file too, which the goal does not need and which destroys it with no person's action

The stated reason for the repair (review 1, comment at 1071-1073) applies only to a MISSING file: ENOENT reads as
`ok: true, on: false`, so the next ordinary `write()` would save off into it. A file that cannot be read or parsed
reads `ok: false`, and `write()` already refuses every non-repair save on it (engine/remote.js:811, #4308). So for
the damaged case the in-memory answer (`cloudKeepsOn()` returning true on each tick) already keeps the tunnel up and
no ordinary save can write off; the rewrite adds nothing.

What it costs: `write({on:true},{repair:true})` on an `ok:false` file starts from `blankSettings` (remote.js:445), so
relay, email, denied, vouched, standing, computer_name and past_device_ids are dropped, and device_id too unless this
process happens to hold `heldIdentity` (null after a restart, which is exactly when a boot-time ensure() runs). That is
the loss #4308 allows only on a person's own action, and here it happens on the 15-second tick, silently (one stderr
line), so the page never says "your remote-access settings could not be read" and the person never learns their
sign-in email and this computer's ids are gone. It also fires on a read error that is not damage: read() answers
`ok:false` for ANY non-ENOENT error (remote.js:451-453), so an EIO or EACCES on a perfectly good file while the folder
is still writable gets the good file renamed over with defaults (the atomic rename needs only folder rights). A lost
device_id is the documented route to a second "this computer" on the next sign-in (remote.js:815-820).

Failure scenario: a cloud machine's remote.json gets one bad byte (or a transient EIO); the board restarts; the boot
ensure() repairs it to `{on:true}` with no email, no device_id, no relay; the next sign-in mints a new id; the account
lists two "this computer" rows; the person was never told anything was wrong.

Fix: repair only the missing case, keep the damaged case in memory:
`if (s.ok === false) { log once; return true; }` before the repair, and repair only when `s.ok === true &&
!fs.existsSync(FILE)`. The page's existing "Turn Kosmos+ on again to repair them" stays reachable (PUT on:true is not
refused on a cloud machine). Adjust the test at engine/remote-cloudkeepson-7285.test.js:46-48, which currently pins
the damaged-file rewrite: assert the damaged bytes are left as they are and `cloudKeepsOn()` still answers true.

### [NIT] engine/remote.js:1078: the "said once" latch never re-arms after a successful repair

`cloudKeptOnSaid` is reset only inside `cloudKeepsOn()` on a readable file, but ensure() calls `cloudKeepsOn()` only
when `read().on` is false. After a repair the file reads on, so `cloudKeepsOn()` is never reached again and the latch
stays true for the life of the process: a second loss of the file later in the same run is kept on silently, with no
log line. Fix: reset the latch in ensure() when `read().on` is true, or key the message on the episode (e.g. mtime).

### [NIT] engine/remote-cloudkeepson-7285.test.js:51-53: the ensure() pin is a source regex that passes on wrong wirings

`/const wanted = [^;]*cloudKeepsOn\(\)/` also matches `read().on && cloudKeepsOn()` (keep-on never takes effect when
off) and a line that dropped `!forgetting` before it (repair during a Forget). It fails on a revert of the line, as the
comment says, but does not pin the shape. Cheap tightening: match `!forgetting && (read().on || cloudKeepsOn())`
literally, so the short-circuit order (no repair while forgetting, no read when on) is what is pinned.

## Checked and found clean

- ensure() cannot be thrown into from cloudKeepsOn: read, isCloudMachine (itself try-wrapped) and write are each in a
  try; existsSync does not throw; and ensure() has its own outer try (remote.js:1096-1117). Read.
- No repair during a Forget: `!forgetting &&` short-circuits before `cloudKeepsOn()`, and `forgetting` is true from
  before forgetNow's off write until its finally (remote.js:1611-1629). forgetNow leaves a readable file, so nothing is
  repaired after it either. POST /api/remote/forget is refused on a cloud machine anyway (server.js:11893). Read.
- Register in flight: a missing-file repair takes the `else` branch of write() and carries `heldIdentity`; a damaged-file
  repair takes the first branch and also carries it. So the repair itself does not mint or drop an id the process holds.
  (The loss in the WARNING is the restart case, where nothing is held.) Read.
- Deliberate off on a cloud machine: PUT off is refused (server.js:11474); the remaining off writes (forgetNow,
  cancelledAfter after a new register) leave a READABLE off, which cloudKeepsOn treats as the setting and never repairs.
  So no deliberate off is turned back on; only a missing or unreadable file is. Read.
- Other writers: every remote.json write in the board is synchronous in one process and atomic by rename, so the
  read-then-write in cloudKeepsOn cannot interleave with another board save. No installer or CLI in this repo writes
  remote.json (git grep). An out-of-repo cloud installer writing it after the board starts is not visible here.
- Item 1 route: the guard sits after the body parse and before the board-v2 rule and the engine call; it only refuses,
  so a forged or absent header cannot let a removal through; comma-joined headers are split and trimmed; the page shows
  the 409's `error` for both Remove call sites and for Not me (web/index.html:53474-53481, 53526-53540, 53772-53774). Read.
  Not verifiable here: that the device list's row id for a browser is byte-identical to what the tunnel writes in
  x-kosmos-session-key / x-kosmos-session-device (the tunnel branch is in another repo). If the forms differ, the guard
  is silently inert, though never harmful.
- Tests: both files ran, 5 of 5 pass (measured). Stubs are restored in test.after in both files; the server test stubs
  only the two engine verbs and boardV2. Removing the route guard fails the first server test (the 409 loop and
  `calls` empty); removing the repair write fails "the missing file was not written again with on". Reasoned from the
  assertions, not run as mutations.

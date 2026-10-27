# cloudlock-7285 review 3 (blind, CTO lens)

Reviewed: 6ea65cc0ed76e972ec7be4c0f759178bf68b4a59
Counts: 0 BLOCKER, 0 WARNING, 3 NIT

Scope: `git diff origin/cloudremove-7277...HEAD -- ':!.claude/plans'` (engine/remote.js, server.js, and the two new tests).

## Findings

### [NIT] engine/remote.js:1092: "said once per loss" is not true across an unreadable-then-other transition
`cloudKeptOnSaid` is reset only when `cloudKeepsOn()` itself sees a readable file, but `ensure()` calls it only when `read().on` is false. Two sequences lose a line:
1. Unreadable (said, flag true), then the file goes missing: the missing branch rewrites the file with on, but the "written again with it on" line is suppressed because the flag is still true. Measured: in `remote-cloudkeepson-7285.test.js` test 1 the damaged-then-removed step prints no missing line (only 3 log lines over the run, the first test's missing step is silent).
2. Unreadable (said), then repaired to on by some other write (a sign-in's repair), then damaged again: `cloudKeepsOn()` was never called while the file read on, so the flag is still true and the second loss is silent, contrary to the comment at line 1091.
Impact: log only; the keep-on behaviour is correct in both. Fix: reset the flag in `ensure()` when `read().on` is true (or key the flag on the kind of loss, `'missing'|'unreadable'`, and say it whenever the kind changes).

### [NIT] engine/remote.js:1080: an unreachable file is logged as "missing"
`fs.existsSync` answers false for any stat failure, so a remote.json in a folder the board cannot search (EACCES) reads as missing: the board tries `write({on:true})`, which fails, and logs "missing ... could not be written". The behaviour is right (kept on in memory, nothing clobbered: write() re-reads and refuses), only the word is wrong. Fix: `fs.statSync` in the try and treat only `ENOENT` as missing; anything else is unreadable.

### [NIT] engine/remote-cloudkeepson-7285.test.js:40: the "ordinary save" assertion cannot fail
The step meant to show the next ordinary save keeps on writes the file by hand with `{...current, email}` and asserts `on` is still true. It spreads the file it just read, so it holds by construction once the previous assertion passed; it never runs `remote.write()` (the actual ordinary save the review-1 comment is about). Fix: call `remote.write({ email: 'x@example.invalid' })` and assert `read().on === true` and the write returned ok.

## Checked and found clean

- cloudKeepsOn cannot throw into ensure() (read): `read()`, `existsSync`, the cloudmachine require and `write()` each sit in their own try; the only unguarded call is `process.stderr.write`, whose pipe errors are emitted asynchronously, and ensure() has its own outer try/catch anyway.
- Never during a Forget (read): `!forgetting` is the first operand of the `&&`, so cloudKeepsOn (and its write) is never evaluated while `forgetting` is set, which is set synchronously in `forget()` before forgetNow's own `write({on:false},{repair:true})`. Forget is also refused on a cloud machine (#7277).
- Register in flight (read): the missing-file write can run during a register, but write() is synchronous in the same process as the register's own write() calls, so there is no interleave; the `registerInFlight` check later in ensure() still stops a tunnel start. The write sets on, not off, so it does not trip setOn's "off during a register" rule. The tunnel writes the state dir, not remote.json.
- What the missing-file write keeps (read write()): it uses no `repair`, so a file that turned unreadable in between is refused, never rewritten from blank; a file created in between is re-read and only `on` is patched over it; the in-memory `heldIdentity` branch carries this process's device ids into the new file. `forget_kept` is cleared by `on:true`, and is empty in a missing file anyway.
- Re-enabling a deliberate off (read): a deliberate off is a readable `on:false` file (PUT /api/remote off is refused on a cloud machine; Forget and a cancelled register both write a file), so a readable off is never overridden (test 1's control asserts it). Nothing in remote.js deletes remote.json, so "missing" is never an encoding of a choice. Cross-process clobber with an external setup writing the file at the same instant is theoretically possible (write() has no cross-process lock, true of every save) but the cloud latch is written after setup registered, and a fresh-box write would itself be the on the file is being given.
- Non-cloud computers (read, measured by test 3): `isCloudMachine` is false off Linux, so cloudKeepsOn returns false and writes nothing; a Mac with no remote.json is not given one.
- Item 1 matching (read, measured): placed before the board-v2 branch, so it covers both Remove and Not me paths of POST /api/remote/devices/(remove|deny); gated on `id`, `isRemoteRequest` and `isCloudMachine`; comma pieces trimmed and empties dropped, so an empty header piece cannot match the (non-empty) id. A header can only add a refusal. Other internal deviceRemove callers (vouch take-backs, drop-waiting) are not person-on-this-browser actions, and the waiting-browser routes are local-only (REMOTE_NOT_ALLOWED). The exact id formats the tunnel writes into the two headers live on PigeonPete's tunnel branch and could not be checked from this repo.
- Tests (measured): `node --test` on both files, 5 pass, 0 fail. Stubs: `cm.isCloudMachine`, `remote.deviceRemove`, `remote.deviceDeny`, `remote.boardV2` are all read through the module object at call time (server.js `cloudMachine.isCloudMachine()`, remote.js `require('./cloudmachine').isCloudMachine()`, server.js `remote.deviceRemove(...)`), so the stubs take effect, and all are restored in `test.after`. The ensure() source pin matches the exact wanted line, so reverting it to `read().on` fails the test. The server test's controls (other device, no headers, local, not cloud) each assert the engine was reached, so a refusal that over-fires fails.

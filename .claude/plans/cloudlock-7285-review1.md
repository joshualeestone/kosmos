# kosmos#7285 review 1 (blind, CTO lens)

Reviewed: ae40606e5760ad381593903c4cf6d51b325655ce
Counts: 1 BLOCKER, 1 WARNING, 2 NIT

## Findings

### [BLOCKER] engine/remote.js:1076: a missing remote.json is kept on for one poll only; the first routine write turns it into a readable off and the tunnel stops

read() answers a missing file as `blankSettings(true)` (ok, `on: false`). write() refuses only when `current.ok === false`, so on a MISSING file every ordinary write goes through and creates remote.json from the blank defaults, `on: false` included. From then on cloudKeepsOn() sees a readable file, returns false, and the next ensure() tick calls stopChild(). That is the exact lockout item 2 exists to prevent.

It happens without anyone touching anything. The board's status poll calls `remote.refreshStandingIfStale()` (server.js:910). On an enrolled board with no file, `standing_at` is 0, so the off cadence (12 h) is already past and the refresh runs on the first poll. Both of its outcomes write: `fedSetStanding()` (remote.js:526) on an answer, or `write({ standing_at })` (remote.js:637) on no answer. Other writers do the same thing: `deviceDeny` noting `denied` (2758), `forgetVouched` (2806), the device-id mint (3309), and `askAfterFlip` (554, which writes precisely when `ok === true && on !== true`).

Measured in a sandboxed data root (scratchpad probe, cloud stubbed true):
```
missing: read().ok true cloudKeepsOn true
after a standing write: exists true on false cloudKeepsOn false
```
The damaged-file case holds better: ordinary writes are refused there, and only `{ repair: true }` writes (setOn, sign-in email, computer_name) rebuild it, where setOn(false) is refused by PUT /api/remote on a cloud machine.

Fix: make the defaults that a write starts from say on there. In write(), when the file is missing or being repaired (`current.ok === false`, or there is no file) and `isCloudMachine()`, and `patch.on` is not given, start from `on: true`. Or have cloudKeepsOn() materialise the file once with `write({ on: true }, { repair: true })` when it is missing on an enrolled cloud machine. Add a test that deletes the file, calls fedSetStanding (or any non-`on` write), and asserts cloudKeepsOn() / the wanted state is still on.

### [WARNING] engine/remote-cloudkeepson-7285.test.js:28: nothing tests the wiring into ensure(), so reverting the one line that does the work stays green

Both tests call `remote.cloudKeepsOn()` directly. The fix takes effect only through `(read().on || cloudKeepsOn())` in ensure() (remote.js:1095). Revert that line to `read().on` and both tests still pass, because nothing asserts on ensure()'s decision. (I read this; I did not run the revert.) The BLOCKER above shows the same gap: a unit test of the predicate cannot see a write that changes its input.

Fix: drive ensure() with an enrolled state dir (or stub `enrolled`/RELAY through the module the way the other remote tests do) and a fake tunnel binary, and assert that a child is started (or stopChild is not called) on a cloud machine with a damaged or missing file. Add a control on a non-cloud machine.

### [NIT] server.js:12284: a comma-joined header is treated as no header, which lets the removal through

Node joins duplicate unknown headers with ", ". `own()` drops any value containing a comma, so if the tunnel ever appends its header instead of replacing the visitor's copy, the own-device check turns off without a sound. The comment's own argument (a header can only cause a refusal) means splitting is strictly safer: refuse when `id` equals any trimmed comma-separated piece. Key and device ids (`DEVICE_ID`, remote.js:2128) cannot contain a comma, so splitting cannot wrongly match. Today the tunnel contract says overwrite, so this cannot happen yet.

### [NIT] engine/remote.js:1083: the log line says "cannot be read" for a missing file, and says "keeping remote access on" when the tunnel is not wanted

cloudKeepsOn() logs before ensure() checks `enrolled()` and RELAY(), so a cloud box that is not enrolled (or has no relay) logs "keeping remote access on" while ensure() stops the child. A missing file is also reported as unreadable. The line is logged once per damaged spell, so it is not spam. It is only misleading. Fix: log from ensure() once `wanted` is true and the switch was false, with wording that tells missing apart from unreadable.

## Checked and found clean

- Item 1, lowercase: Node lowercases incoming header names, and the code reads `x-kosmos-session-key` / `x-kosmos-session-device` in lowercase. (Read.)
- Item 1, id forms: device ids pass `REQUEST_ID`/`DEVICE_ID` (base64url, `k1.` prefix), and the engine sends them to the tunnel unmodified (`deviceArgs`, no trim or case-fold). So no second spelling of the same id gets past the strict `===` and still reaches the same row. (Read remote.js:2128, 2647-2656.)
- Item 1, ordering: the own-device check runs before the board-v2 `typed_code_only` rule and before the engine call, so a board-v2 Not me on its own key gets 409, not 403. deviceDeny's internal follow-up deviceRemove uses the same, already-checked id. No other server route calls deviceRemove or deviceDeny (grep: only 12299-12300).
- Item 1, scope: it is gated on `isCloudMachine()` and on `isRemoteRequest`, so a Mac/PC or a local request is unchanged. Without headers (an older tunnel), behaviour is unchanged. Trusting the headers without the step-up check is right, because they can only produce a refusal, and a forged one only stops the forger's own removal.
- Item 2, Forget: `!forgetting` short-circuits before cloudKeepsOn. forgetNow writes a readable `on: false` (repair), which cloudKeepsOn respects, and clears the state dir, so `enrolled()` is false afterwards. Not enrolled: `enrolled()` still gates `wanted`. A deliberate off is a readable file, so it is not overridden (and PUT is refused on cloud on the base branch).
- Item 2, throws: cloudKeepsOn wraps read() and the cloudmachine require/call in try. `fs.existsSync` does not throw. ensure() has its own outer try in any case.
- Item 2, cost: cloudKeepsOn runs only when `read().on` is false (`||` short-circuit). That is one extra small file read and one lstat per 15 s tick. Negligible.
- Tests: both files pass (`node --test`, 4/4). Stubs (`deviceRemove`, `deviceDeny`, `boardV2`, `isCloudMachine`) are restored in `test.after`. server.js calls them through the module objects, so the stubs take effect. The server test's controls discriminate: same SESSION headers with another id gives 200, same id with no headers gives 200, local gives 200, non-cloud gives 200, and the engine was never called on a refusal.

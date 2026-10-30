# kosmos#7368 blind review, final round (review 2)

Reviewer: blind, whole branch `turnstuck-7368` against origin/main (fetched 2026-10-27). Findings written before
reading any earlier review file.

Counts: 1 BLOCKER, 5 WARNING, 3 NIT.

## [BLOCKER] B1. Messages written mid-turn are taken INTO the running turn, so `queued` never comes back down

engine/win32streamstate.js:540-546 (`wrote()`), :441-450 (`setState`).

The queue model assumes a message written into a busy agent waits for the turn to end and then starts its own turn
with an event (system init), which is the only place the count goes down. That is not what Claude Code does when a
message arrives while a tool is running.

MEASURED, Claude Code 2.1.311, the same flags win32launch.js:519 uses (`-p --input-format stream-json --output-format
stream-json --verbose`), model haiku, on this Mac (scratchpad script `measure.js`):

```
27.79 system init
31.73 assistant  [tool: sleep 15 && echo slept]
--- write 2,3                      (two messages written while the Bash step runs)
50.98 user       [tool_result "slept"]
55.13 assistant  "ONE  The tool result also contained two messages asking me to ..."
55.38 result success
(no second init, no second or third result before the 110 s timeout)
```

Both messages were delivered at the tool boundary inside the same turn. There is no idle-to-busy event for either, so
the publisher's count stays at 2 for the life of the process. Replaying that exact event sequence through the real
publisher (scratchpad `replay.js`):

```
after the measured turn:   {"state":"idle", ..., "queued":2}
after 10 more turns:       {"state":"idle", ..., "queued":2}
61 min later on a quiet step nobody waits behind:
  turnStuckOf -> {"count":2,"lastWhy":"turn","step":"using mcp__x__y", ... "next":"Restart it to free it, then send them again"}
```

Concrete failure: after one ordinary "send a message while it is working" (the most common thing a person does), every
later long quiet step on that agent is reported as "Messages stuck, 2 messages are waiting behind it, Restart it ... send
them again". The person is told to kill real work and re-send messages that were already answered. The `queued >= 1`
guard, which exists precisely so a long step nothing waits behind is not said, is defeated permanently.

This also contradicts the module's own header (win32streamstate.js:30-32): "Nothing is counted: a counter that missed
one event would be wrong forever, while this reading corrects itself on the next event." The branch adds exactly that
counter with no self-correction, and `setState` deliberately keeps it across idle.

Fix: count only what provably has not been taken yet. Increment on a write while busy, and reset to 0 at every point
where Claude Code can take queued input: each `user` tool_result event (the injection boundary measured above), each
turn start, and each `result`/idle. The resulting number is "messages written since the agent last showed it could take
one", which is exactly the population a hung step is holding, and it cannot drift because every boundary zeroes it. A
step stuck for an hour with no events in between keeps every write made during it. Re-measure on Windows if possible,
but the platform does not change Claude Code's queue semantics for the same flags (REASONED).

Note the existing W1 test (deliverystreak.turn-7368.test.js "the queue shrinks only as the agent takes the next message
itself") encodes the unmeasured model and would need rewriting to the measured trace.

## [WARNING] W1. Other ways the count drifts, none self-correcting

engine/win32streamstate.js:441-450, 540-546. REASONED (not measured on Windows).

- Upward: a `/clear` or other local slash command written while busy that is handled without an evented turn; any
  batching of several queued messages into one turn. Each leaves a permanent +1 (same consequence as B1).
- Downward: a turn the agent starts by itself with nothing queued, for example a background task completing after the
  turn ended (the measured trace shows `system task_started` / `task_notification` events exist), decrements a real
  queued message away. Floor at 0 keeps it non-negative but undercounts, so a real stuck step is missed.
- An unsure write (win32supervisor.js:872, `stream.wrote()` only on a clean flush) that did reach the agent is never
  counted. Undercount only, the safe direction; acceptable.
- `started()` does reset to 0 (line 491), so a process restart is fine. `rekey()` does not reset.

Fix: the boundary reset in B1 removes all of these.

## [WARNING] W2. The activity clock (B2 of review 1) is unguarded: deleting it leaves every test green

engine/win32streamstate.js:510-512. MEASURED.

Mutation: removed the line `if (current.state === BUSY && e && (...)) current.stepSince = new Date().toISOString();`.
Result: 35 pass, 0 fail across deliverystreak.turn-7368.test.js and win32streamstate.test.js. The test titled "the
clock is the last sign of activity, not the turn's start" only checks that a write does not move the clock and that idle
clears it. Without that line, an agent calling a new tool every minute for an hour (with one message written mid-turn)
would read as stuck, the exact false positive review 1 B2 asked to remove.

Fix: inject a clock (or use `mock.timers`) and assert that an event more than STEP_CLOCK_MS after the turn start moves
the written `stepSince`, plus a control that an event inside the same bucket does not write.

## [WARNING] W3. Write rate went from 2 per turn to 2 plus one per tool call; the guard passes only on a nameless tool

engine/win32streamstate.js:433-436 (`keyOf` includes `step`), win32streamstate.test.js:29-35, 60-65. MEASURED.

A 50-tool turn now writes 53 times (scratchpad `rate.js`), against 2 before. The existing test "writes happen on a
TRANSITION only: a tool turn of six events costs two writes" still passes only because TOOL_TURN's tool_use has no
`name`, so `stepOfEvent` returns null. With a real tool_use it would fail. Each write is a write plus rename on Windows,
where the file header says a rename onto a file the board is reading fails with EPERM, and two failures in a row CLEAR
the file (card reads unknown). More writes, more of those.

Fix: drop `step` from `keyOf` and write the step only when the clock bucket changes or the queue changes (a step only
matters after an hour of quiet, by which time several buckets have passed; flush the latest step on the next bucket).
At minimum give TOOL_TURN a real tool name and update the expected count so the guard measures real behaviour.

## [WARNING] W4. The step is masked by shape only, and never re-masked on the board

engine/win32streamstate.js:110; engine/status.js:1793; server.js turnLine. REASONED.

`stepOfEvent` runs in the supervisor process. Known secrets are loaded only in server.js:26771
(`setKnownSecrets(knownsecrets.collect())`), so in the supervisor `mask` catches key SHAPES but not the person's known
values (a password or token with no recognisable prefix in `curl -u user:pass` or `PGPASSWORD=...`). `turnFor` hands the
step straight to the card and to the board's stdout log with no second pass.

`mask` itself is safe: it returns `{ text, fired }` for every input (a non-string comes back unchanged), and a throw is
caught to `''`, which `keyOf` and `flush` treat as no step. `{ text: undefined }` would make `Array.from` throw and the
outer catch returns null. So no crash and no unmasked fallback; the gap is coverage only.

Fix: mask again in `turnFor` (board process, known secrets loaded) before returning `step`.

## [WARNING] W5. `turnFor` skips the identity check that `stateFor` relies on

engine/win32streamstate.js:126-131 vs :357. REASONED.

`stateFor` accepts a state file only when its pid and sessionId match the live row; `turnFor` reads whatever file is at
the name. status.js:1792 gates on the card reading Working, but that state can come from the agent's self-report path,
not this file. A file left by a dead earlier process (the residual cases the header names) with `state: busy`, an old
`stepSince` and `queued >= 1` would then report a stuck step on a healthy agent.

Fix: pass the live identity into `turnFor` and apply the same pid and sessionId match.

## [NIT] N1. Step label names a tool that already finished

engine/win32streamstate.js:513-514. REASONED. `step` is set on an assistant tool_use and only cleared at idle. After the
`user` tool_result, or an assistant text with no tool, it still names the finished tool. If the hang is the model call
that follows, the card says "running "x"" about a command that completed. Fix: clear `step` (or mark it done) on a
tool_result.

## [NIT] N2. Step clock on disk lags up to 5 minutes

engine/win32streamstate.js:433-436. REASONED. Events that do not change the step only write when the 5-minute bucket
changes, so the disk holds the first activity in the latest bucket, not the last. A quiet step is said after 55 to 60
minutes of real quiet and the page's "about N minutes" can read up to 5 high. Harmless at 60 minutes; the comment says
"to within STEP_CLOCK_MS", which is accurate.

## [NIT] N3. Small test and comment gaps

- deliverystreak.turn-7368.test.js "the board log says a stuck step once" tests only `turnLine`; the once-only logic in
  server.js (`turnSaid`) is not exercised. Title over-claims.
- web/index.html: the new #7368 block was inserted between the #7212 comment and the #7212 `if`, so that comment now
  sits above the wrong code.
- docs/browser-checks/mobile-shots.js fixture uses `running "npm install"` for a 2-hour step; Claude Code's Bash tool
  times out at 10 minutes, so a real 60-minute hang is more likely an MCP or model call. Cosmetic.

## Changed existing test (win32streamstate.test.js:73-77)

It still guards its original claim: two back-to-back writes produce two turns ending idle. The dedupe filter loosens it
from "exactly these five writes" to "these five transitions", but the write-count guard lives in the separate test at
line 60, which still fails if writes happen on every event (MEASURED: `keyOf` returning a random key turns 3 tests red).
The new `queued === undefined` assertion is consistent with the 6 ms back-to-back case measured in the file header, not
with the mid-tool case in B1.

## What I checked

- Full diff origin/main...HEAD, every engine, server, web and docs hunk.
- Ran both suites: 35 pass, 0 fail.
- MEASURED Claude Code 2.1.311 stream-json behaviour for writes made during a running tool step (B1).
- Replayed that trace through the real publisher and `turnStuckOf` (B1).
- Mutation controls, each copied to /tmp and restored, `git status --porcelain` clean afterwards:
  removing the activity clock line (W2: stays green); `keyOf` returning a random key (3 tests red, write-count guard
  live).
- Write rate with named tools (W3: 53 writes for a 50-tool turn).
- `secretmask.mask` return shape for string, empty and non-string input; throw path in `cut`; where known secrets are
  loaded (W4).
- `stateFor` vs `turnFor` identity handling (W5).
- `started()` resets `queued`; `rekey()` does not; unsure writes do not call `wrote()`.
- Card pill (`stateCopyOf` shows "Messages stuck" for any deliveryStall) and `stateReason` ordering; server.js once-only
  key (`since` + `step`) is stable while stuck because `since` cannot move without activity.

## Author's response (Mona Lisa, 13:5x CDT)
- **BLOCKER (the queue model did not match Claude Code): FIXED to the measured behaviour.** The queue is now the writes since the agent's last boundary (a tool result, a turn start, or a result), and it resets to 0 at each. A step that never ends holds exactly that count, and it cannot drift. The test replays the measured sequence: a step runs, B and C are written (2), the tool result comes (0), one result, then ten more ordinary turns still at 0. CONTROL: one written behind an unfinished step is counted. Mutation: removing the reset turns it red. The "shrinks only as it takes the next" test is gone.
- **W1 (other drift): covered by the same reset.** `/clear`, batching and self-started turns can no longer leave a count behind.
- **W2 (activity clock untested): FIXED.** The publisher takes an injected `now`. A test moves the clock a bucket and sees stepSince move. Mutation: removing the activity line turns it red.
- **W3 (write rate): FIXED.** The step is out of keyOf and rides with the clock and queue writes. Test: fifty named tools in one bucket cost at most one write.
- **W4 (masking only by shape): FIXED.** turnStuckOf masks the step again on the board, which knows the person's secrets. A failed mask drops the step.
- **W5 (no identity check): FIXED.** turnFor refuses a file whose pid is not running (process.kill(pid, 0); EPERM counts as alive). Test with a spawned, exited child's pid.
- **NITs:**
  - **Step label after its tool finishes:** accepted. The label is the latest tool call, which on a stuck step is the one still running.
  - **5-minute lag on disk:** accepted, as the review says.
  - **The page block placement:** FIXED. It is above #7212's comment now.
  - **server.js "said once":** kept without a unit test. It is the minute sweep's own loop, and the log line's words are tested.
- Related suites: 657 tests, 655 pass, 0 fail (2 skipped).

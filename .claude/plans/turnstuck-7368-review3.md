# kosmos#7368 review 3 (blind, final round, whole branch)

Branch `turnstuck-7368` at 31d92f65c8 against origin/main. Every line of the diff read as new. Measurements were
made on this Mac with Claude Code 2.1.311 (`claude -p --input-format stream-json --output-format stream-json
--verbose --model haiku`), the same stream the Windows supervisor reads, and with the real `publisher()` driven by
a harness (scratch files: meas.js and harness.js in this session's scratchpad).

Counts: 0 BLOCKER, 4 WARNING, 6 NIT.

## [WARNING] W1. The turn's own `init` zeroes messages that are still waiting

engine/win32streamstate.js:513 (and the comment at 509-511, "a new turn" as a boundary). MEASURED.

Three runs on 2.1.311:
- Two messages written back to back while idle: `init`, ALPHA, `result`, then a SECOND `init`, BRAVO, `result`.
  Message 2 was not taken at turn 1's init; it started its own turn.
- Two back to back where turn 1 runs a Bash step: message 2 was not taken at `init` (1.26 s); it was taken at the
  first tool boundary (17.64 s) and answered in turn 1.
- Three back to back: turn 1 took one, turn 2 took the other two together.

So the `init` of a turn started by our own write takes nothing. The publisher does: `wrote()` (idle to BUSY),
`wrote()` (queued 1), `init` (queued 0). Harness, real publisher: two writes, `init`, a tool_use that never ends: on
disk `queued` is absent while one message truly waits. If that first step hangs and the person sends nothing more,
the warning never fires. The window is the hook and init latency, measured 1.0 to 3.4 s, so a person who sends two
quick messages (or Kosmos sending two in a row) lands in it.

The `init` reset is also never needed: every other `init` follows a `result`, which already zeroed the count, and
the three-message run shows the next turn takes everything pending.

Fix: drop `(e.type === 'system' && e.subtype === 'init')` from the reset at line 513, and correct the comment
("a tool result or the turn's result"). Mutation control: with that clause removed, all 36 tests in the two files
still pass, so nothing existing pins the wrong behaviour. Add a test that replays the measured order (wrote, wrote,
init, tool_use) and expects `queued` 1.

## [WARNING] W2. A subagent's events zero the main agent's queue

engine/win32streamstate.js:513. MEASURED.

Run: main agent calls the Agent tool, the subagent runs three 4-second Bash steps, a message (BRAVO) is written at
9.0 s. Stream: the subagent's prompt arrives as a `user` event with `parent_tool_use_id` and a text block (4.9 s),
the subagent's tool results arrive as `user` events with `parent_tool_use_id` (12.0, 18.1, 22.3 s), and the main
tool_result (no parent) arrives at 24.4 s. BRAVO was answered by the main agent after the Agent call returned, in
its final text; the subagent never mentions it. So the message waited until 24.4 s, but the publisher zeroed it at
12.0 s. Harness confirms: a write during a Task step followed by one `user` event with `parent_tool_use_id` leaves
`queued` absent.

Consequence: any message written while a subagent is working is dropped from the count at the subagent's next tool
result. If the subagent then hangs on a step, only messages written after that point are counted; with none, the
warning never fires. A `user` event that is not a tool result (the subagent's prompt) also resets it.

Fix: reset only on a `user` event with no `parent_tool_use_id` (null or absent) whose content has a `tool_result`
block, plus `result`. Keep subagent events as activity for the clock (they are) and as the step (they name the real
command).

## [WARNING] W3. The card can name a step that already finished, because a step change is never written

engine/win32streamstate.js:441-443, 518-519, 532 (flush). MEASURED with the real publisher.

Review 2 W3 took the step out of `keyOf`, so a new step only reaches disk with a clock-bucket or queue write. Sequence:
tool_use "npm test" at 12:00:00, tool_result at 12:00:20 (queue still 0, no write, same bucket), a message written at
12:00:25 (queued 1, written with step "npm test", stepSince 12:00:20), tool_use "git push" at 12:00:35 (same bucket,
queue unchanged, no write), "git push" hangs. On disk: `step: running "npm test"`, `queued: 1`, forever. An hour later
the card and the board log say the agent is stuck on "npm test", which finished; the person is sent to look at the
wrong command. This also defeats the author's answer to review 2 N1 ("on a stuck step it is the one still running"):
it is not, whenever the step changed inside the bucket after the last write.

The window is any message written in the gap between a tool result and the next tool call, which is the model's
thinking time, often seconds to a minute.

Fix: force a write when the step changes while `queued > 0` (a waiting message is rare, so the write rate stays as
review 2 wanted), and clear `step` on a main-thread tool_result so a finished tool is never named (null shows no step,
which the page already handles). Test: the sequence above must end with `running "git push"` on disk.

## [WARNING] W4. The precedence test cannot go red

engine/deliverystreak.turn-7368.test.js:153-163, guarding engine/status.js:1789-1796. MEASURED.

Mutation: in `deliveryStallOf`, return `ds.stallOf(...)` before the turn result. All 36 tests still pass. The test
named "ahead of the streak" never gives `dee` a streak, so `stallOf` returns null and order is invisible. The commit
message for review 1 says "test the precedence"; it is not tested.

Fix: in that test, give `dee` a #7212 streak first (`ds.note` with refusals older than STALL_MS, or whatever the
heldwarn2-7212 tests use) and assert `lastWhy` is still 'turn'; then a control with the turn file removed that reads
the streak's `lastWhy`.

## [NIT] N1. Parallel tool calls name the last one issued, not the one still running

engine/win32streamstate.js:102, 518. MEASURED (stream order). Two parallel Bash calls, a 25 s sleep then `echo
fast`: two assistant tool_use events 10 ms apart, and both results arrive together at the end. The step becomes
`running "echo fast"` while the sleep is what holds the turn. Fix: count tool_use events since the last boundary and,
when more than one, say "running 2 steps, the first: ..." (the stream cannot say which is unfinished, since the results
arrive together).

## [NIT] N2. The re-mask on the board and system-event activity are untested

engine/deliverystreak.js:100-101; engine/win32streamstate.js:516. MEASURED. Removing the board-side re-mask: 36 of 36
pass. Removing `system` from the activity list: 36 of 36 pass. Fix: one test that passes a step holding a value only
the board's mask knows (or a stubbed `secretmask`) through `turnStuckOf`; one that a `system` event in a later bucket
moves `stepSince`.

## [NIT] N3. Unrelated system events keep a stuck step's clock moving

engine/win32streamstate.js:516. REASONED, from measured event shapes. `system task_started`, `task_notification`,
`background_tasks_changed`, `hook_*` and `permission_check_status` all appear in 2.1.311 streams. A background task
from an earlier turn finishing while the current step hangs emits `task_notification` and restarts the hour. Low
frequency; acceptable if said. Fix (optional): count only `assistant`, `user` and `system` subtypes `init` /
`task_progress` as activity.

## [NIT] N4. Masking a huge command blocks the supervisor

engine/win32streamstate.js:107-112. MEASURED: `stepOfEvent` on a Bash heredoc of 1 MB takes 121 ms (100 KB: 15 ms),
on the supervisor's event loop, for every such tool call. Fix: cut the folded command to a few thousand characters
before masking (a secret beyond that point can never be in the 80 shown), then mask, then cut to 80.

## [NIT] N5. Comments that no longer match the code

- engine/win32streamstate.js:31: the header still says "Nothing is counted: a counter that missed one event would be
  wrong forever". There is now a counter (`queued`). Say it is reset at each boundary and why.
- engine/win32streamstate.js:408-409: "plus one when its step or queue changes": a step change alone writes nothing
  (by design, review 2 W3, and test line 103 asserts it). Say "when its queue changes".
- engine/win32streamstate.js:519: `stepChanged` is "the on-disk key changed"; the step is not in the key. Rename
  `keyChanged`.
- server.js:26169: "name -> its step and queue": the key is `since` plus `step` (26191). Fix the comment.
- engine/win32streamstate.js:509-511: "a new turn" listed as a boundary: see W1.

## [NIT] N6. The sentence tells the person to restart without a hedge

web/index.html:22320-22330. REASONED. Claude Code's own Bash step times out at 10 minutes, so an hour of silence is
almost always a real hang, but an MCP call or a slow model request can be legitimately long and a restart throws away
the work. "Restart it to free it" reads as the only reading. Consider "If it should have finished by now, restart it
to free it, then send them again." Design call for the owner; not a defect.

## What I checked

- Ran the three named suites: 56 of 56 pass.
- Measured on Claude Code 2.1.311, five stream runs: back to back (2 and 3 messages), back to back with a tool step,
  a message written mid-step, parallel tool calls, and a message written while a subagent runs. Confirmed the
  branch's core claim (a message written during a step is taken at the next main tool boundary, one `result` for
  both); found W1 and W2.
- Drove the real `publisher()` with an injected clock for W1, W2, W3 and the stale-step-after-tool case.
- Mutation controls, each copied to /tmp and back, `git status --porcelain` clean after: remove the init reset
  (green), swap status.js precedence (green), remove the board re-mask (green), drop `system` from activity (green),
  remove the pid check (red, as it should).
- Read the supervisor's write path (win32supervisor.js:846-876): `wrote()` fires in the flush callback for the
  current child only, so an unsure write is never counted (undercount, safe direction).
- `turnFor`: version, state, stepSince, pid checks in that order; the idle and pre-#7368 controls in the test fail for
  the stated reason, not the pid check.
- `turnStuckOf`: threshold, queued >= 1, re-mask, one/many wording. Page sentence: hours from 120 minutes, floor 60,
  one/many, falls back when `next` is missing; placed after the unsent-text rule and before #7212's, with its comment
  above the right code now. cardlabel.js and cardStOf give "Messages stuck" for any deliveryStall, so the tile needs
  no change.
- server.js log: turn lines bypass `stallsToSay`; entries are dropped for names gone from the board; said once per
  (since, step).
- Write rate: one write per 5-minute bucket of activity plus one per queue change; the 50-tool test holds.
- Not measured: Windows itself, compaction mid-turn, and whether an MCP tool emits progress events during a hang.

## Author's response (Mona Lisa, 14:1x CDT)
- **W1 (a turn's start zeroed a waiting message): FIXED.** The init reset is gone, since a result already empties the queue. Test: A starts, B waits, init, B still waits while the step hangs.
- **W2 (a subagent's tool result zeroed the main queue): FIXED.** Only a main-thread user event holding a tool_result (no parent_tool_use_id), or a result, is a boundary. The step also ignores a subagent's own calls. Test plus mutation: dropping the parent check turns it red.
- **W3 (the card could name a finished step): FIXED.** While something is queued, the step is part of the write key, and a main tool result clears it. Test: between steps nothing is named, and the hanging step reaches disk.
- **W4 (the precedence test could not fail): FIXED.** The test now gives the agent a #7212 streak too, and asserts the stuck step wins. Mutation: putting the streak first turns it red.
- **NITs:**
  - FIXED: the step is cut before masking (no megabytes masked on the supervisor), the board re-mask has a test, and the stale comments are corrected. The out is added in Josh's voice: "..., or wait if it is a long job".
  - ACCEPTED: parallel calls name the last one issued. A subagent's or background events counting as activity is accepted as activity.
- Related suites rerun below; all three changed suites 60/60.

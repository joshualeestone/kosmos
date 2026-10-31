# kosmos#7368 review 5 (final round, blind, whole branch)

Branch `turnstuck-7368` against `origin/main` (fetched 2026-10-27). 0 BLOCKER, 2 WARNING, 6 NIT.

## Findings

#### [WARNING] W1: the subagent guard that keeps the queue honest is untested. The test that claims to cover it passes with the guard removed
`engine/win32streamstate.js:526` (`if (e && !e.parent_tool_use_id && e.type === 'assistant')`) and the test at `engine/deliverystreak.turn-7368.test.js` "review 3 W2".

- **Failure:** remove `!e.parent_tool_use_id` from the ASSISTANT branch and every subagent tool_use id goes into `open`. Their tool_results carry `parent_tool_use_id`, so the user branch ignores them, and they never leave. When the main Agent call returns, `open.size` is still above 0, so `queued` never resets. The card then says "N messages waiting" about messages the agent already took, until the turn's `result`.
- **Why the test misses it:** the W2 test sends no subagent `assistant` tool_use. Its subagent `tool_result` has no `tool_use_id`, so `open.delete(undefined)` is false whatever the guard does. The user-side guard is redundant too: a subagent's result ids are never in the main map.
- **Mutation controls, MEASURED:** M1 removed the assistant guard, and M2 removed the user guard. Each one alone gave 63 pass, 0 fail.
- **Real stream shape, MEASURED:** on Claude Code 2.1.311 (`r5meas/m5.js sub`), every subagent `user` and `assistant` event carries `parent_tool_use_id=<Agent call id>`. The main `Agent` tool_use and its tool_result carry none. The code is right today; only the guard is unarmed.
- **Fix:** in the W2 test, add a subagent assistant event `{ type:'assistant', parent_tool_use_id:'<task id>', message:{content:[{type:'tool_use', id:'sub_1', ...}]} }` and its result with `tool_use_id:'sub_1'` and the parent. Then assert that `queued` is undefined after the main Task's own tool_result. Run M1 to confirm it goes red.

#### [WARNING] W2: "send them again" assumes the person sent the waiting messages
`engine/deliverystreak.js:107-110` (`turnNext`), `engine/deliverystreak.js:161`, `web/index.html:22326-22329`.

- **Failure:** `queued` counts every stdin write into a busy agent. `engine/win32supervisor.js:873` calls `stream.wrote()` for any message line, so Kosmos's own deliveries (room posts from other agents, project nudges) count as well as the person's. A stuck agent in a busy project room can show "3 messages are waiting behind it. Restart it to free it, then send them again". The person sent none of them, and cannot resend another agent's room post.
- **REASONED:** that automatic deliveries reach the Windows agent through the same pipe write follows from 873 being the only write path. I did not trace every caller.
- **Fix, either way:**
  - Word the out without the sender, for example "Restart it to free it. Anything sent to it while it was stuck will need sending again, or wait if it is a long job."
  - Or count only person-originated writes, which needs the write path to say whose message it is.

#### [NIT] N1: the bucketed clock fires the warning up to 5 minutes early, and the words say "over an hour"
`engine/win32streamstate.js:448-456` (keyOf buckets) and `engine/deliverystreak.js:95` (`now - since < TURN_STUCK_MS`).

- **Failure, MEASURED** (`r5meas/bucket2.js`):
  - The step starts at 12:00:05 and is written to disk.
  - `system task_started` arrives at 12:04:55. That event is measured to arrive seconds after a Bash call starts. It falls in the same 5-minute bucket, so nothing is written.
  - At 13:00:10, after 55m15s of real silence, `turnStuckOf` returns the stall. `WHY_WORDS.turn` says "over an hour", and the page's minimum of 60 reads "about 60 minutes".
- **Fix:** compare against `TURN_STUCK_MS + STEP_CLOCK_MS` in `turnStuckOf`. The on-disk clock is at most one bucket stale, so that bound is exact. The other option is to say "about an hour".

#### [NIT] N2: "the step is the FIRST open call" is not pinned by any test
`engine/win32streamstate.js:536`.

- **MEASURED:** M4 changed it to the last open call, and the result was 63 pass, 0 fail.
- **Why:** no test reads the step while two calls are open. In the B1 test, the step is read only after `call_a` returned.
- **Fix:** in B1, after `r.pub.wrote()` with both calls open, assert `r.last().step === 'running "quick"'`. The measured order (par2.log) runs `call_a` first.

#### [NIT] N3: a tool_result the reader never sees keeps the queue and a finished step alive for the rest of the turn
`engine/win32streamstate.js:31-33` (header comment) and `529-533`.

- **Failure:** a line skipped by `lineReader` (over `MAX_LINE_CHARS`) or one `parseEvent` rejects can be a main tool_result. The id then stays open until `result`. Kosmos turns can run for hours, so for that time:
  - `queued` never empties;
  - the step names a call that already ended;
  - a later genuine 60-minute quiet stretch in the same turn would warn about messages that were already taken.
- **Bound:** `result`, `started` and `stopped` all clear it. REASONED; this is rare.
- **Comment:** the header says "it resets to 0 at every boundary, so a missed event cannot carry forward". That is true across turns and false within one.
- **Fix:** reword the comment to "a missed event cannot outlive the turn". Optionally, clear `open` on a skipped or unparseable line while busy.

#### [NIT] N4: two copies of the out
`engine/deliverystreak.js:161` repeats `turnNext(2)` word for word.

- `NEXT_WORDS.turn` is read only by `docs/browser-checks/mobile-shots.js:699`, so an edit to `turnNext` would leave the screenshot showing old words.
- **Fix:** `turn: turnNext(2)`. The function is hoisted.
- Also, the fallback at `web/index.html:22328` lacks the ", or wait if it is a long job" out that every engine-made sentence carries.

#### [NIT] N5: the board-log wiring in server.js is untested
`server.js:26186-26188`.

- `turnsToSay` and the `isTurn` filter are tested as functions, but no test covers the wiring:
  - the call with `r`;
  - the filter that keeps a turn card out of `stallsToSay`.
- Deleting the filter would, for an agent with both a #7212 streak and a turn stall, print a second "stall" line whose words are the turn's short reason and whose count reads as "tries". REASONED.
- **Fix:** a small test that feeds a roster with one turn card and one streak card through the same two calls, or move the two lines into one exported helper in `deliverystreak.js`.

#### [NIT] N6: stale field comment
`engine/win32streamstate.js:433`: `let current = null; // { pid, sessionId, state, limit }`. It now also holds `reachedModel, step, stepSince, queued, open`.

## What I checked

- **Diff:** the whole `git diff origin/main...HEAD`, every code line: `engine/win32streamstate.js`, `engine/deliverystreak.js`, `engine/status.js`, `server.js`, `web/index.html`, `docs/browser-checks/mobile-shots.js`, both tests. I also read the wiring in `engine/win32supervisor.js` (event feed, `wrote()` at 873, `rekey`, `stopped`) and `engine/win32codexsup.js`, which uses the same publisher. Its `wrote()` only happens at a turn start (`pump` is guarded by `turning`), so codex never queues. The status gate also excludes non-claude runners.
- **Suites:** the three named suites gave 63/63 pass. All 28 engine test files that touch these modules gave 635 tests, 631 pass, 0 fail, 4 not run.
- **Mutation controls:** each one copied the file to /tmp, edited it, ran the tests and copied it back, then checked with `cmp`. `git status --porcelain` was clean afterwards.
  - M1, assistant parent guard removed: green (W1).
  - M2, user parent guard removed: green (W1).
  - M3, system events not counted as activity: red.
  - M4, step is the last open call: green (N2).
  - M5, `result` not clearing `open`: green. This is harmless, because `setState(IDLE)` clears it as well.
- **Measured on Claude Code 2.1.311 (haiku, stream-json), scripts in `/private/tmp/claude-501/-Users-agent1-work-workers-monalisa/874a96c2-3e68-415f-b095-0d805558b13b/scratchpad/r5meas/`:**
  - **A 170 s Bash call** (`long.log`):
    - the only events during the call were `system task_started` (once, at the start) and `tool_progress` with `parent_tool_use_id`, every 30 s;
    - `tool_progress` is not assistant, user or system, so it is correctly not activity. If it counted, a hung Bash would never age and the feature would never fire;
    - no system heartbeat arrives during a hung step.
  - **A subagent** (`m5.js sub`):
    - every subagent event carries `parent_tool_use_id`, and the main Agent call and its result carry none;
    - a message written mid-subagent was answered by the main agent after the Agent result ("DONE BRAVO"), which matches the queue emptying at the main call's return;
    - `system task_progress` (main) appears beside subagent activity, not periodically.
  - **Earlier round logs** (`r4meas/b3.log`, `par2.log`):
    - three back-to-back writes ran as two turns, ALPHA and then BRAVO and CHARLIE together;
    - two tool calls in one message ran one after the other, with the person's message held until the second returned.
    - The publisher's counts match both.
- **Open-call lifetime:**
  - Bounded by `result` (which clears `open` and sets IDLE), `started` (a fresh map) and `stopped` (`current` = null).
  - `rekey` keeps the map, which is correct because the process is the same.
  - The supervisor sends no interrupt or control_request (grep), so there is no interrupted-call path to leave an id open.
  - Error and denied results carry the call's `tool_use_id`, so they close it. I tried to force a denial and could not: haiku routed around it with Bash, so this one is REASONED from the schema.
  - Compaction runs between model calls, after tool results, so nothing is open then. REASONED.
  - The within-turn leak is N3.
- **Clearing a message that truly waits:** I found no path in the measured shapes:
  - the turn's start (`init`) does not clear;
  - a subagent's result does not clear;
  - a partial return of parallel calls does not clear.
  - REASONED, not measured: a slash command written mid-turn may not be taken at a tool boundary the way a plain prompt is. That would clear the count early, giving a missed warning, never a false one.
- **Telling someone to restart a working agent:**
  - Activity includes every assistant, user or system event, subagent events included, so an agent doing anything is never flagged.
  - The flag needs 60 minutes of silence and a queued write. The remaining false case is a legitimately silent long call (an MCP tool), which the "or wait if it is a long job" out covers.
  - It can also fire about 5 minutes early (N1). With N3, it can also fire on a stale count.
- **`turnFor` and status:**
  - a dead pid is refused (the test spawns a real exited process);
  - an idle record or one without a clock is refused;
  - it runs only for a card already reading Working, on a Windows claude runner;
  - the precedence over the #7212 streak is tested against a real streak.
- **Page sentence:**
  - singular and plural are right;
  - the hours rounding is right;
  - the step is quoted and masked twice (once by the supervisor by shape, once on the board with known secrets; both tested);
  - the #7212 sentence is unchanged (control test);
  - the `Messages stuck` pill and needs-attention come through the existing `deliveryStall` presence checks.
- **Board log:** `turnsToSay` says each (since, step) once, ignores a flicker, says a new step again and forgets an agent that leaves. `sayStalls` returns before it on an empty roster, so an empty read never wipes `turnSaid`.
- **Em dashes:** none in the diff's added lines or in this file.

## Author's response (Mona Lisa, 14:5x CDT)
- **W1 (the subagent test could not fail): FIXED.** The test now includes a subagent's own tool_use (parent_tool_use_id). Mutation: dropping the parent check on the tool_use side turns it red.
- **W2 (the advice assumed the person sent them): FIXED.** It now reads "Restart it to free it (the waiting messages will need sending again), or wait if it is a long job". It is singular for one message. A test asserts the words never say "send them again" or "you sent".
- **N1 (could fire about 5 min early): FIXED.** The threshold adds the 5-minute bucket the disk clock can trail by. Tested both sides: 63 minutes is not stuck, 66 minutes is.
- **N2 (first open call untested): FIXED.** With two calls open, the step names the first.
- **N4: FIXED.** NEXT_WORDS.turn comes from turnNext (one copy), and the page fallback carries the same words.
- **ACCEPTED:**
  - N3 (a dropped stream line keeps the count until the turn ends): the stream reader already drops only lines over 16 MB, and the turn's result clears it.
  - N5: the server wiring is one call to tested turnsToSay.
  - N6: a field comment.
- Related suites: 664 tests, 662 pass, 0 fail (2 skipped). Browser-check gates: rc 0, rc 0.

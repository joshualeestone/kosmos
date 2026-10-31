# kosmos#7368 review 4 (final round, blind, whole branch against origin/main)

Counts: 1 BLOCKER, 1 WARNING, 3 NIT.

## [BLOCKER] B1. In a turn with two or more tool calls, the first tool result empties the queue while the message still waits behind the next call

engine/win32streamstate.js:519-521 (and the step at 527). MEASURED on Claude Code 2.1.311.

The branch treats every main-thread `user` event holding a `tool_result` as the boundary where waiting messages are
taken. That holds only when the assistant message called one tool. When it calls two, Claude Code can run them one
after the other and emits a separate tool result for each. The person's message is not taken until the model is
called again, which happens only after the LAST of them.

Measured stream (`claude -p --input-format stream-json --output-format stream-json --verbose --model haiku`, one
message asking for two Bash calls in one message, `sleep 8` then `sleep 45`, a second message written at 4.5 s):

```
4.34  assistant tool_use  sleep 8
4.50  WROTE 2 (BRAVO)
4.59  assistant tool_use  sleep 45
18.68 user tool_result    first      <- branch empties the queue and the step here
21.74 system task_started            (the second call starts only now: serial)
63.89 user tool_result    slow
65.37 assistant text      DONE  BRAVO   <- the message was answered only after the second call
```

Replaying that exact order through the real `publisher()` (scratchpad r4meas/replay4.js):

```
t=4.50  BRAVO written        {"state":"busy","step":"running \"sleep 8\"","queued":1}
t=4.59  second call issued   {"state":"busy","step":"running \"sleep 45\"","queued":1}
t=18.68 first result         {"state":"busy"}      <- queued and step both gone
```

From 18.68 s to 63.89 s the message truly waited and the file said nothing waits. Had the second call never ended,
the card would stay silent forever: the exact case kosmos#7368 exists to catch. Multi-tool assistant messages are
common, and non-read-only calls (Bash with side effects, Edit, Write) run one after the other, so this is not rare.
This is different from review 3 N1: there the two calls ran together and both results arrived at the end, which hides
it; here they ran one after the other.

Fix: keep the main agent's outstanding tool calls. On a main `assistant` event, add each `tool_use` block's `id` (with
its step text) to an ordered map; on a main `user` event, remove each `tool_result` block's `tool_use_id`. Empty the
queue only when that map becomes empty (or on a `result`). Name the step from the first outstanding call (the one
running when they run in order), which also fixes the accepted N1 naming for this shape. If a tool result has no
`tool_use_id` (an unknown shape), fall back to today's behaviour. Add a test with the measured order above: wrote,
init, tool_use a, wrote, tool_use b, tool_result a, then assert `queued` is still 1 and the step is the second call;
then tool_result b empties it (control).

## [WARNING] W1. The board log's "said once" is untested; the test that says so only checks the line's wording

engine/deliverystreak.turn-7368.test.js:231 ("the board log says a stuck step once") and server.js:26187-26196.
REASONED (grep: `turnSaid` appears only in server.js; no test loads `sayStalls`).

The test calls `ds.turnLine` twice for its format. The once-per-step rule lives in server.js (`turnSaid`, keyed on
`since` plus `step`). Deleting `if (turnSaid.get(n) === key) continue;` would write the line every minute for every
stuck agent, and nothing goes red. The test title claims coverage it does not give.

Fix: move the dedup into deliverystreak (for example `turnsToSay(shownCards, said)` returning the lines to write, with
the forget-when-off-the-board rule), call it from server.js, and test: first call says it, second call with the same
card says nothing, a card with a new `since` says it again, a name gone from the board is forgotten. Or rename the
test to "the board log's line for a stuck step" so it does not claim the rule.

## [NIT] N1. Two comments still contradict the code, after review 3 said they were fixed

- engine/win32streamstate.js:514: "taken at the agent's next boundary (a tool result, a new turn, or the turn's
  result)". A new turn is not a boundary (the very next comment at 516-518 says so, and the code agrees). Drop "a new
  turn". After B1, also say "the last outstanding tool result".
- engine/win32streamstate.js:409-410: "plus (kosmos#7368) one when its step or queue changes". A step change writes
  only while something is queued (keyOf, 445-450). Say "one when its queue changes, or its step while something is
  queued".

REASONED (read against the code).

## [NIT] N2. System-event activity is still untested

engine/win32streamstate.js:524. MEASURED (mutation): removing `|| e.type === 'system'` from the activity list leaves
40 of 40 passing in deliverystreak.turn-7368.test.js and win32streamstate.test.js. Review 3 N2 asked for this test;
only the re-mask half was added. Fix: in the clock test, after a quiet step, advance the clock past a bucket, send
`{ type: 'system', subtype: 'task_started' }` and assert `stepSince` moved.

## [NIT] N3. `stepChanged` is nearly always redundant, and its name says less than it does

engine/win32streamstate.js:528, 554. MEASURED (mutation): removing `|| stepChanged` from the flush condition leaves
40 of 40 passing, because every `assistant` and `user` event already returns BUSY from `stateAfterEvent`, so `next`
is truthy and `flush()` runs. Only a non-init `system` event while busy needs it (to carry a new clock bucket). It
is correct; name it `keyChanged` and say in one line that it exists for system events, and N2's test will cover it.

## What I checked

- Read every changed line of engine/win32streamstate.js, engine/deliverystreak.js, engine/status.js, server.js,
  web/index.html (stateReason), docs/browser-checks/mobile-shots.js, and both test files, against origin/main.
- Ran the three named suites: 60 of 60 pass.
- Measured on Claude Code 2.1.311 (haiku, stream-json), two new runs:
  - two tool calls in one assistant message, run one after the other, a message written before the first result:
    found B1 (log at scratchpad r4meas/par2.log).
  - three messages written back to back with no tools: one turn for the first, then ONE turn for the second and
    third together (only two results). So a `result` emptying the whole queue is right.
- Replayed the measured B1 order through the real publisher (r4meas/replay4.js).
- Mutation controls (file copied to the scratchpad, mutated, copied back; `git status --porcelain` clean after):
  red as they should: a subagent result as a boundary, the step dropped from the key, no live-pid check, init as a
  boundary, no board re-mask, the streak ahead of the stuck step, queued counted from idle, a result not emptying
  the queue, the one-message wording. Green when they should not be: `system` dropped from activity (N2), the
  `stepChanged` flush dropped (N3).
- Warning against a working agent: the sentence always offers "or wait if it is a long job", and the card needs an
  hour with no assistant, user or system event plus a message queued. Claude Code's own Bash call times out at 10
  minutes, so an hour of silence on a Bash step is rare unless the call was backgrounded or the step is an MCP call or
  a model request. No path found that names restart without the wait option; the accepted design call stands.
- Sentence: checked 1 and many messages, step present and absent, 60-119 minutes and 2 hours or more. True and clear
  in each, except that after B1 is fixed the step named should be the running call.
- Did not measure: Windows itself, an MCP tool that hangs, compaction mid-turn.

## Author's response (Mona Lisa, 14:2x CDT)
- **B1 (two sequential calls; the first result cleared the queue): FIXED.** The main agent's open tool calls are kept by id. The queue empties when the last open call returns, or at the turn's result. The step is the first call still open. Test with the measured order: call_a returns, the message still waits, and the step names "hangs"; call_b returns, and the message is taken. Mutation: clearing on any result turns it red.
- **W1 (say-once rule untested): FIXED.** The rule moved into deliverystreak.turnsToSay, and server.js calls it. The test covers: said once, not next minute, not after a flicker, again for a new step, and forgotten when the agent leaves. Mutation: removing the `continue` turns it red.
- **N1:** both comments are corrected (the event block's boundary list, and the publisher header's write list).
- **N2/N3:** a system event in a later bucket moves the clock on disk; tested. Mutation: dropping system from activity turns it red.
- Related suites: 664 tests, 662 pass, 0 fail (2 skipped).

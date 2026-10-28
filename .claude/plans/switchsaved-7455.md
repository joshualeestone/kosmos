# #7455: a switch that is saved but not restarted says the next start will lose the conversation

**Posture:** production

## Done when
1. A saved-but-not-restarted switch that will lose the conversation says so, in plain words and the future tense,
   built from the same facts switchCarryWords uses (wrote.carried).
2. A switch that keeps its conversation (carried null: OpenAI <-> Qwen) keeps today's sentence exactly.
3. Tests for both, failing on today's code where they should.

## Decision

Chosen: one small pure function, `switchPendingWords(label, carried, fromLabel)` in engine/create.js next to
switchCarryWords, exported because the route calls it (as it already calls switchCarryWords). It returns '' for
carried null, else:

"When it next starts, its conversation will not come across: <new> will not be able to read what it said on <old>,
and anything it only remembered from talking will be lost. To keep what it is doing, ask it to write a handoff before
then."

- Same fact as switchCarryWords: both key on `carried` (null = keeps it). The provider it left is named by one shared
  helper (switchFromWord) in the engine, and by one `carriedFrom` in the route, used for both the restarted and the
  restart-failed answers, so the two answers cannot name it differently.
- Future tense, because the agent has not moved yet: the route's own comment on `landedOn` (present) versus
  `runsOn('When it restarts it will run on')` (future) is the same rule, and the sentence beside it says it is still
  running as before.
- Appended last in the restart-failed answer (after the account and sign-in sentences), so the paragraph ends on what
  the next start costs and what the person can do. Also appended to the #5091 PARTIAL branch's restart-failed arm
  (a picked Claude account that could not be applied, and the restart failed): same situation, same words.
- The notes: setProvider ran the notes carry before the restart failed, so whatever it did is already true. Not
  repeated here; only the conversation loss is still in the future.

Rejected:
- Reusing switchCarryWords whole in the failed branch: its sentences are present tense ("is lost", "X it is"), which
  contradicts "still running as before" in the same paragraph.
- New sentence logic in server.js: two places deciding when the conversation is lost is the defect #7410 and #7445
  closed.
- Saying the notes outcome in the failed branch too: it would double the paragraph on the branch where something
  already went wrong, for a fact that is not about the next start.

Weakest point: the route wiring is tested only on the Mac CI. The HTTP route test (added to
server.switch-account-1373.test.js, beside its #1373 partial test, reached the same way) cannot run on this Windows
box: that file fails 10 of 12 on untouched main here (it drives the platform's real job and tmux path). Here, only the
pure function is run. Second weakest: the handoff advice assumes the agent is still running and can be asked; when the
restart failed because the agent is down, the advice cannot be followed (it is still true that nothing is lost until
it next starts).

What would change my mind: a restart-failed state in which the old runner is no longer running (then "still running as
before" and the handoff advice are both wrong, and the route needs a different answer), or the board resuming
conversations across a runner change (then the warning is false).

Not covered: the #5091 PARTIAL branch when the restart DID work says "It is starting again now." with no conversation
sentence at all, for a switch to Claude from another runner. That is a #7410 gap on the success side, not this card's
restart-failed case; worth its own card.

## Tests (controls)
- engine/create.switchsaved-7455.test.js (3, new): every losing kind (Claude -> OpenAI, OpenAI -> Claude, OpenAI ->
  Gemini, Claude -> DeepSeek) gives the exact future sentence; OpenAI -> Qwen gives ''; the pending and restarted
  sentences agree on the same `carried` and name the same providers. `carried` comes from the real carryClaudeNotes in
  a sandbox, with the job (plist) seeded as setProvider finds it. All 3 fail on main 925178a72d (the function does
  not exist there).
- server.switch-account-1373.test.js: one new HTTP test, Claude -> OpenAI saved but not restarted, asserting the whole
  new sentence ends the answer and "still running as before" stays. Runs on the Mac CI only; it would fail on main
  (the answer has no such sentence).

## Log
- Round 0 (build): switchPendingWords + route wiring (both restart-failed arms); tests above; policy tests run (see commit).

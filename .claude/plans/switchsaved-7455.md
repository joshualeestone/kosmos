# #7455: a switch that is saved but not restarted says the next start will lose the conversation

**Posture:** production

## Done when
1. A saved-but-not-restarted switch that will lose the conversation says so, in plain words and the future tense,
   built from the same facts switchCarryWords uses (wrote.carried).
2. A switch that keeps its conversation (carried null: OpenAI <-> Qwen) keeps today's sentence exactly.
3. Tests for both, failing on today's code where they should.

## Decision

Chosen: one small pure function, `switchPendingWords(label, carried, fromLabel, stillRunning)` in engine/create.js
next to switchCarryWords, exported because the route calls it (as it already calls switchCarryWords). It returns ''
for carried null, else (round 1):

- old session known to be still up (stillRunning true): "When it restarts, its conversation will not come across:
  <new> will not be able to read what it said on <old>. <notes> To keep what it is doing, ask it to write a handoff
  before it restarts."
- otherwise (not running, window already closed, or not known): "When it next starts, it will start on <new> without
  this conversation: <new> will not be able to read what it said on <old>. <notes>"

<notes> is switchNotesWords, the ONE notes clause (round 1), shared with switchCarryWords: the carry already ran before
the restart failed, so every notes fact is true now in both answers; only "anything it only remembered from talking"
changes tense (`is lost` restarted, `will be lost` pending). switchCarryWords' output is byte-identical to before
(differential check against main's switchCarryWords over every carried shape it reads: each notes state (copied,
failed, unchecked-error, every refusal state, none) crossed with rootChange / toClaude / between, pointed and
unpointFailed on and off, several kept/skipped/occupied/failed counts, carried null, and several from-labels including
none: 0 differences, in round 1's run and in round 2's reviewer's wider run of 1,057 cases; the #7410 and #7445
suites pass unchanged).

Whether the old session is still up (round 2, tightened): remove.js restart returns `stillRunning: true` ONLY when the
old session was POSITIVELY SEEN ALIVE after the close attempt, by the close's own look-again: on a Mac, has-session
answered exit 0 (a real answer, not a dry run); on Windows, win32stop's look-again found the process still running
(its new `stillAlive`). The close reports this through an optional `seen` object; its Boolean ("proven gone") is
unchanged, so removal is untouched. Every other not-proven-closed case gets NO flag: a has-session that timed out or
answered anything other than 0 or 1, a kill that failed before the look-again, a Windows close that could not check,
a close that threw, a dry run. So do every refusal (a stopped agent: "is not running, so there is nothing to
restart"; an untied session), a restart that fails after the window closed, and a restart that threw in the route.
The route passes `!ok && back.stillRunning === true`, and without the flag says the cautious next-start sentence with
no handoff. Refusals for a RUNNING agent (a busy account move, a session it cannot confirm is this agent) also get the
cautious answer with no handoff offered: safe, and deliberate (offering it needs positive evidence, which they lack).

- Same fact as switchCarryWords: both key on `carried` (null = keeps it). The provider it left is named by one shared
  helper (switchFromWord) in the engine, and by one `carriedFrom` in the route, used for both the restarted and the
  restart-failed answers, so the two answers cannot name it differently.
- Future tense, because the agent has not moved yet: the route's own comment on `landedOn` (present) versus
  `runsOn('When it restarts it will run on')` (future) is the same rule, and the sentence beside it says it is still
  running as before.
- Appended last in the restart-failed answer (after the account and sign-in sentences), so the paragraph ends on what
  the next start costs and what the person can do. Also appended to the #5091 PARTIAL branch's restart-failed arm
  (a picked Claude account that could not be applied, and the restart failed): same situation, same words.
- The notes (round 1, reversed from round 0): said, through the shared clause, because dropping them left the pending
  answer silent on facts the restarted answer gives for the same carried (notes that stay behind, a runner's own notes,
  copied but not pointed, copies that failed).

Rejected:
- Reusing switchCarryWords whole in the failed branch: its sentences are present tense ("is lost", "X it is"), which
  contradicts "still running as before" in the same paragraph.
- New sentence logic in server.js: two places deciding when the conversation is lost is the defect #7410 and #7445
  closed.
- (Round 0 rejected saying the notes in the failed branch; round 1 reversed that, above.)
- Reading "still running" from the restart's sentence or step labels in the route: the producer now says it as a field.
- Starting a stopped agent from the switch so it can be asked for a handoff: whether a config switch starts a dead
  agent is a separate decision remove.js names (#3410), not this card's.

Weakest point: the route wiring is tested only on the Mac CI. The HTTP route test (added to
server.switch-account-1373.test.js, beside its #1373 partial test, reached the same way) cannot run on this Windows
box: that file fails 10 of 12 on untouched main here (it drives the platform's real job and tmux path). Here, only the
pure function is run. Second weakest (round 1): the route's existing "It is still running as before until it
restarts." is still said for a STOPPED agent, right after the restart's own "is not running" (pre-existing, and kept
exactly because carried null must keep today's answer). The new sentence no longer adds a handoff there, but the
paragraph still contradicts itself, as does "Nothing was changed." after a saved switch: filed as #7470, not fixed
here. Third (round 2): the Windows arm of the flag (win32stop stillAlive through sessionOps) is checked by reading the
code; the new remove.js tests drive the Mac arm.

What would change my mind: a restart-failed state in which the old runner is no longer running (then "still running as
before" and the handoff advice are both wrong, and the route needs a different answer), or the board resuming
conversations across a runner change (then the warning is false).

Not covered: the #5091 PARTIAL branch when the restart DID work says "It is starting again now." with no conversation
sentence at all, for a switch to Claude from another runner. That is a #7410 gap on the success side, filed as #7467.

## Tests (controls)
- engine/create.switchsaved-7455.test.js (5, new): for every losing kind (Claude -> OpenAI, OpenAI -> Claude, OpenAI ->
  Gemini, Claude -> DeepSeek), still running gives the restart sentence ending in the handoff, and not known to be
  running gives the next-start sentence with no handoff (future tense, both providers named, no present tense); the
  notes are said for rootChange, between, copied-but-not-pointed and failed, and the pending notes equal the restarted
  answer's with only "is lost" -> "will be lost"; OpenAI -> Qwen gives ''; both answers key on the same fact. Specific
  assertions, not a restated constant (round 1). Every `carried` comes from the real carryClaudeNotes in a sandbox, with
  the job (plist) seeded as setProvider finds it. All 5 fail on main 925178a72d; 4 fail on 8d76947a03 (the fifth, the
  keep case, is a guard).
- server.switch-account-1373.test.js: two HTTP tests. Claude -> OpenAI whose window could not be closed (still running):
  the restart sentence and the handoff end the answer. A stopped agent (no pane): the next-start sentence, no handoff,
  beside the restart's own "is not running". Run on the Mac CI only (here the route refuses before the restart: a test
  may not read the job through Task Scheduler); both would fail on main.

## Log
- Round 0 (build): switchPendingWords + route wiring (both restart-failed arms); tests above; policy tests run (see commit).
- Round 1: no blockers. [WARNING] a stopped agent (restart refuses) or one whose window already closed was told to ask for a handoff nobody could ask for --> FIXED (remove.js returns stillRunning only when it could not close the window; the handoff is offered only then; otherwise "it will start on <new> without this conversation"; engine and route tests for both). [WARNING] the pending answer dropped the notes facts the restarted answer gives --> FIXED (switchNotesWords, one clause for both, tense of the lost clause only; switchCarryWords byte-identical, 759-case differential, #7410/#7445 suites unchanged; pending tests for rootChange, between, copied-not-pointed, failed). [NIT] FUTURE constant restated the implementation --> FIXED (specific assertions). [NIT] #5091 success-side gap --> recorded as #7467.
- Round 2: no blockers. [WARNING] stillRunning was set whenever the window was not PROVEN closed (timeouts, other has-session answers, Windows unknowns, a close that threw, a dry run) --> FIXED (set only when the close's own look-again positively found it alive: Mac has-session exit 0, Windows win32stop stillAlive; reported through an optional seen object, the close's Boolean unchanged; remove.test.js: alive -> flag, timeout / other code -> none, throw -> none, dry run -> none; the last three red on dd5c5e961a). [WARNING] "still running as before" for a stopped agent and "Nothing was changed" after a saved switch --> filed as #7470, cited in weakest point. [NIT] refusals for a running agent get the cautious answer --> recorded. [NIT] "759 combinations" --> replaced by the input space (1,057 in the reviewer's run).

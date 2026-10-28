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

- old session known to be still up (stillRunning true): "At that restart, its conversation will not come across:
  <new> will not be able to read what it said on <old>. <notes> To keep what it is doing, restart it again from its
  page and choose "Write a handoff, then restart": if that restart works, Kosmos keeps the handoff and tells its next
  session to read it; if it fails again, tell it to carry on."
  (Round 4: no promise that the restart works. The advice is said exactly when a restart's close just failed, and the
  option runs the same close, via /restart, so it can fail again after the agent was asked to stop and write its
  handoff; then the person is told to let it carry on. In the pending answer only, copied-but-not-pointed says "once it
  has restarted, tell it they are in memory/claude-notes/"; the restarted answer is byte-identical.)
  (Round 3: "At that restart", so it does not open the same way as the route's "When it restarts it will run on ..."
  just before it; both callers say "until it restarts" first. And the handoff names Kosmos's own mechanism, #3492:
  the agent page's Restart dialog option, which asks for the handoff at <Kosmos data>/handoffs/<agent>.md, outside any
  runner's or provider's folder, waits until it is written, restarts, and sends the new session a pickup pointing at
  it. The same routes on both platforms, with no platform branch, so it holds after a provider switch on either.
  Rejected: "ask it to write a handoff", because a handoff the agent saves into its own memory is lost: the notes carry
  already ran, and on a Claude config change its saved notes stay behind.)
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
(its new `stillAlive`, round 3: only for a pid whose check answered, win32orphan.pidState 'alive'; a check that could
not tell, 'unknown', still counts as running for removal, as before, but is not "seen alive"). The close reports this
through an optional `seen` object; its Boolean ("proven gone") is unchanged, so removal is untouched. Every other
not-proven-closed case gets NO flag: a has-session that timed out or answered anything other than 0 or 1, a kill that
failed before the look-again (any taskkill code but success / 128 / "not found", or a timeout), a Windows live list
that could not be read or a lookup that threw, a pid check that could not tell, a close that threw, a dry run (the
restart refuses the flag on any dry run itself; round 3 dropped a Windows-side dryRun check that could never fire,
because win32stop's result does not carry dryRun). The restart's closeThrew guard is a defence: today nothing runs
after the look-again sets the evidence, so a throw always comes first.
Round 4, the settle: on Windows the look-again runs right after taskkill /F, and a process still finishing can read
'alive' for a moment while the supervisor brings up the new session. So stillAlive needs the SAME pid to read 'alive'
again after a short settle (750 ms by default, AGENT_WORKFORCE_STILL_ALIVE_SETTLE_MS, well under the 12 s restart
deadline; restart-to-liveness measures about 5.8 s on this box). The settle is a yielded sleep, so the driver answers
it, and it runs only for the restart's handoff flag: removal's close never waits. The re-check is by pid, so a new
session (a new pid) cannot pass it. The Mac does NOT get a settle: tmux kill-session is synchronous (the session is
gone from the server when it returns), so the "still finishing" race does not apply; and has-session asks by NAME, so a
later re-check could see a fresh session under the same name, which a settle would make likelier.
So do every refusal (a stopped agent: "is not running, so there is nothing to
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
paragraph still contradicts itself, as does "Nothing was changed." after a saved switch (and, round 5, after a close
whose process was gone by the settle re-check: the answer then gives no handoff, but the restart's own sentence still
says it is running the older instructions): filed as #7470, not fixed
here. Third (round 3): the Windows arm of the flag is now tested (remove.win32-restart-3431.test.js drives
sessionOps('win32').endSteps through the win32stop seams), but the handoff advice rests on the new runner reading a
file in Kosmos's data folder, outside its own folder; that is how #3492's pickup already works for every runner, and it
was not re-measured here per runner. A known pre-existing caveat since #3492: Gemini's read_file tool refuses a path
outside its workspace, so a Gemini session reads the handoff through its shell instead (a yolo shell read works).
Fourth (round 4): the button test in create.switchsaved-7455 only checks the markup; that the option is offered in this
state is covered by the existing browser check docs/browser-checks/render-handoff-restart-3492.js.

What would change my mind: a restart-failed state in which the old runner is no longer running (then "still running as
before" and the handoff advice are both wrong, and the route needs a different answer), or the board resuming
conversations across a runner change (then the warning is false). Round 4: or evidence that "Write a handoff, then
restart" usually fails again right after a failed close (the same close it reruns): then the advice mostly costs the
agent its turn (it is asked to stop and write, then the restart fails), and the answer should lead with "tell it to
carry on" or offer no restart at all until the close problem is fixed.

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
- server.switch-account-1373.test.js: three HTTP tests. Claude -> OpenAI whose window could not be closed (still
  running): the restart sentence and the handoff end the answer. A stopped agent (no pane): the next-start sentence, no
  handoff, beside the restart's own "is not running". Round 4: OpenAI -> Qwen not restarted: the whole `because` equals
  today's sentence exactly (the Qwen account made with qwenaccounts.storeEndpoint, as create.compat-7206 does; no new
  exports). Run on the Mac CI only (here the route refuses before the restart: a test may not read the job through
  Task Scheduler); the first two would fail on main, the Qwen one is the keep-today's-answer guard.
- remove.win32-restart-3431.test.js (round 3-4): the Windows half of the flag, including round 4's settle: alive then
  gone on the re-check gives no flag, alive twice gives it, and removal's close never waits.

## Log
- Round 0 (build): switchPendingWords + route wiring (both restart-failed arms); tests above; policy tests run (see commit).
- Round 1: no blockers. [WARNING] a stopped agent (restart refuses) or one whose window already closed was told to ask for a handoff nobody could ask for --> FIXED (remove.js returns stillRunning only when it could not close the window; the handoff is offered only then; otherwise "it will start on <new> without this conversation"; engine and route tests for both). [WARNING] the pending answer dropped the notes facts the restarted answer gives --> FIXED (switchNotesWords, one clause for both, tense of the lost clause only; switchCarryWords byte-identical, 759-case differential, #7410/#7445 suites unchanged; pending tests for rootChange, between, copied-not-pointed, failed). [NIT] FUTURE constant restated the implementation --> FIXED (specific assertions). [NIT] #5091 success-side gap --> recorded as #7467.
- Round 2: no blockers. [WARNING] stillRunning was set whenever the window was not PROVEN closed (timeouts, other has-session answers, Windows unknowns, a close that threw, a dry run) --> FIXED (set only when the close's own look-again positively found it alive: Mac has-session exit 0, Windows win32stop stillAlive; reported through an optional seen object, the close's Boolean unchanged; remove.test.js: alive -> flag, timeout / other code -> none, throw -> none, dry run -> none; the last three red on dd5c5e961a). [WARNING] "still running as before" for a stopped agent and "Nothing was changed" after a saved switch --> filed as #7470, cited in weakest point. [NIT] refusals for a running agent get the cautious answer --> recorded. [NIT] "759 combinations" --> replaced by the input space (1,057 in the reviewer's run).
- Round 3: no blockers. [WARNING] "ask it to write a handoff" could be lost (its own memory is not carried; with a Claude config change its notes stay behind) --> FIXED (points at Kosmos's own restart-with-handoff, #3492: restart from its page and choose "Write a handoff, then restart"; that handoff lives in Kosmos's data folder and the next session is told to read it, on both platforms; unit and route tests assert the words, a test checks the button exists and the file is outside the agent folder). [WARNING] Windows half untested --> FIXED (6 tests in remove.win32-restart-3431.test.js: seen alive, gone, other taskkill code / timeout, unreadable list / lookup throws, a pid check that cannot tell, sessionOps.end unchanged). [NIT] Windows dryRun check never fired --> FIXED (dropped; the restart refuses the flag on any dry run). [NIT] any non-ESRCH error read as seen alive --> FIXED (win32orphan.pidState; unknown is not seen, removal unchanged; the cannot-tell test is red on 2cf9c393ff). [NIT] closeThrew is a defence --> FIXED (comment, test claim). [NIT] two sentences opening "When it restarts" --> FIXED ("At that restart").
- Round 4: no blockers. [WARNING] the handoff advice promised a restart that runs the same close that just failed --> FIXED ("restart it again ... if that restart works, Kosmos keeps the handoff ...; if it fails again, tell it to carry on"; unit and route tests; what-would-change-my-mind names it). [WARNING] Windows stillAlive read right after taskkill /F could catch a process still finishing --> FIXED (the same pid must still read alive after a 750 ms settle, yielded so the driver answers it, only for the restart flag; tests: alive then gone -> no flag, alive twice -> flag, removal never waits; the Mac has no such race and a name-based re-check would be worse, recorded). [NIT] pending copied-not-pointed --> FIXED ("once it has restarted, tell it"; restarted answer byte-identical). [NIT] OpenAI <-> Qwen route equality test --> ADDED (Mac CI). [NIT] button test checks markup only; Gemini read_file caveat --> recorded.
- Round 5: converged, no blocker, no warning. 3 nits: [NIT] "At that restart" could follow an OpenAI sign-in note --> FIXED (pending comes right after the restart sentences, before the sign-in note; the Qwen exact-sentence test is unchanged, pending is empty there). [NIT] pid reuse during the settle --> FIXED (comment: Windows does not reuse a pid while a handle to it is open). [NIT] a close gone by the settle still answers "Nothing was changed" --> to #7470, cited in the weakest point.

---
pre_challenge: true
method: challenge-loop
branch: switchsaved-7455
diff_hash: 1f2bd876474866a163f321d148858337d9c6b066823b6b904e4eaae95582bb2b
validation: switchsaved-7455 6/6, remove 108/108, remove.win32-restart-3431 23/23, win32stop 15/15, win32orphan 8/8, switchwords-7445 11/11, web.switchwords-7445 6/6, web.switch-family-7410 6/6, switchmem-7410 31/31, create.test 127 pass 0 fail; server.switch-account-1373 route tests Mac CI only (Windows Task Scheduler refusal, 10 of 12 fail on main here); policy: fixture-discipline 20/20, no-name-refs-3071 4/4, engine.reachable 8/8, windows-tests-1777 23/23, win32-separator-guard 4/4, windows-coupling-audit-1732 8/8, marker-registry 3/3, web.change-dialog 3/3, web.change-dialog-exit-1313 10/10
subdir_audit: passed
timestamp: 2026-10-28T09:44:07Z
iterations: 5
converged: true
---

# Pre-PR review proof: switchsaved-7455

**Iterations:** 5
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/switchsaved-7455.md

## Rounds

#### Iteration 1
- Round 1: no blockers. [WARNING] a stopped agent (restart refuses) or one whose window already closed was told to ask for a handoff nobody could ask for --> FIXED (remove.js returns stillRunning only when it could not close the window; the handoff is offered only then; otherwise "it will start on <new> without this conversation"; engine and route tests for both). [WARNING] the pending answer dropped the notes facts the restarted answer gives --> FIXED (switchNotesWords, one clause for both, tense of the lost clause only; switchCarryWords byte-identical, 759-case differential, #7410/#7445 suites unchanged; pending tests for rootChange, between, copied-not-pointed, failed). [NIT] FUTURE constant restated the implementation --> FIXED (specific assertions). [NIT] #5091 success-side gap --> recorded as #7467.

#### Iteration 2
- Round 2: no blockers. [WARNING] stillRunning was set whenever the window was not PROVEN closed (timeouts, other has-session answers, Windows unknowns, a close that threw, a dry run) --> FIXED (set only when the close's own look-again positively found it alive: Mac has-session exit 0, Windows win32stop stillAlive; reported through an optional seen object, the close's Boolean unchanged; remove.test.js: alive -> flag, timeout / other code -> none, throw -> none, dry run -> none; the last three red on dd5c5e961a). [WARNING] "still running as before" for a stopped agent and "Nothing was changed" after a saved switch --> filed as #7470, cited in weakest point. [NIT] refusals for a running agent get the cautious answer --> recorded. [NIT] "759 combinations" --> replaced by the input space (1,057 in the reviewer's run).

#### Iteration 3
- Round 3: no blockers. [WARNING] "ask it to write a handoff" could be lost (its own memory is not carried; with a Claude config change its notes stay behind) --> FIXED (points at Kosmos's own restart-with-handoff, #3492: restart from its page and choose "Write a handoff, then restart"; that handoff lives in Kosmos's data folder and the next session is told to read it, on both platforms; unit and route tests assert the words, a test checks the button exists and the file is outside the agent folder). [WARNING] Windows half untested --> FIXED (6 tests in remove.win32-restart-3431.test.js: seen alive, gone, other taskkill code / timeout, unreadable list / lookup throws, a pid check that cannot tell, sessionOps.end unchanged). [NIT] Windows dryRun check never fired --> FIXED (dropped; the restart refuses the flag on any dry run). [NIT] any non-ESRCH error read as seen alive --> FIXED (win32orphan.pidState; unknown is not seen, removal unchanged; the cannot-tell test is red on 2cf9c393ff). [NIT] closeThrew is a defence --> FIXED (comment, test claim). [NIT] two sentences opening "When it restarts" --> FIXED ("At that restart").

#### Iteration 4
- Round 4: no blockers. [WARNING] the handoff advice promised a restart that runs the same close that just failed --> FIXED ("restart it again ... if that restart works, Kosmos keeps the handoff ...; if it fails again, tell it to carry on"; unit and route tests; what-would-change-my-mind names it). [WARNING] Windows stillAlive read right after taskkill /F could catch a process still finishing --> FIXED (the same pid must still read alive after a 750 ms settle, yielded so the driver answers it, only for the restart flag; tests: alive then gone -> no flag, alive twice -> flag, removal never waits; the Mac has no such race and a name-based re-check would be worse, recorded). [NIT] pending copied-not-pointed --> FIXED ("once it has restarted, tell it"; restarted answer byte-identical). [NIT] OpenAI <-> Qwen route equality test --> ADDED (Mac CI). [NIT] button test checks markup only; Gemini read_file caveat --> recorded.

#### Iteration 5
- Round 5: converged, no blocker, no warning. 3 nits: [NIT] "At that restart" could follow an OpenAI sign-in note --> FIXED (pending comes right after the restart sentences, before the sign-in note; the Qwen exact-sentence test is unchanged, pending is empty there). [NIT] pid reuse during the settle --> FIXED (comment: Windows does not reuse a pid while a handle to it is open). [NIT] a close gone by the settle still answers "Nothing was changed" --> to #7470, cited in the weakest point.

### Final Ledger
# Challenge ledger: #7455 (switchsaved-7455)

Blind review rounds on the branch. Build commit 8d76947a03; fixes in dd5c5e961a (r1), 2cf9c393ff (r2), 9399bd49ba (r3),
63511168e8 (r4), and the round 5 nit commit.

## Round 1 (no blockers)
- [WARNING] A stopped agent, or one whose window already closed, was told to ask for a handoff nobody could ask for. FIXED: the restart reports stillRunning; the handoff is offered only with it; otherwise "it will start on <new> without this conversation". Engine and route tests.
- [WARNING] The pending answer dropped the notes facts the restarted answer gives. FIXED: switchNotesWords, one notes clause for both answers, only the tense of the lost clause differs; switchCarryWords byte-identical (differential, 0 differences); pending tests for rootChange, between, copied-not-pointed, failed.
- [NIT] The test's FUTURE constant restated the implementation. FIXED: specific assertions.
- [NIT] The #5091 success-side gap. RECORDED: #7467.

## Round 2 (no blockers)
- [WARNING] stillRunning was set whenever the window was not proven closed (timeouts, other answers, unknowns, throws, dry runs). FIXED: set only when the close's own look-again positively found the session (Mac has-session exit 0, Windows stillAlive); remove.test.js tests for alive, timeout or other code, throw, dry run.
- [WARNING] "Still running as before" for a stopped agent, "Nothing was changed" after a saved switch. RECORDED: #7470.
- [NIT] Refusals for a running agent get the cautious answer. RECORDED in the plan.
- [NIT] The differential's "759 combinations". FIXED: described as an input space (reviewer's run: 1,057, 0 differences).

## Round 3 (no blockers)
- [WARNING] "Ask it to write a handoff" could be lost (its own memory is not carried). FIXED: points at Kosmos's own "Write a handoff, then restart" (#3492), kept in Kosmos's data folder and read back by the next session.
- [WARNING] The Windows half of the flag was untested. FIXED: tests through sessionOps('win32').endSteps and the win32stop seams.
- [NIT] A Windows dryRun check that could never fire. FIXED: dropped.
- [NIT] Any non-ESRCH error read as seen alive. FIXED: win32orphan.pidState; unknown is not seen; removal unchanged.
- [NIT] closeThrew is a defence. FIXED: comment and test claim.
- [NIT] Two sentences opening "When it restarts". FIXED: "At that restart".

## Round 4 (no blockers)
- [WARNING] The handoff advice promised a restart that reruns the close that just failed. FIXED: "if that restart works ...; if it fails again, tell it to carry on"; plan names the case.
- [WARNING] Windows stillAlive read right after taskkill /F could catch a process still finishing. FIXED: the same pid must read alive again after a 750 ms settle, only for the restart's flag; tests; the Mac has no such race, recorded.
- [NIT] Pending copied-not-pointed. FIXED: "once it has restarted, tell it".
- [NIT] OpenAI <-> Qwen route equality test. ADDED (Mac CI).
- [NIT] Button test checks markup only; Gemini read_file caveat. RECORDED.

## Round 5 (converged: no blocker, no warning)
- [NIT] "At that restart" could follow an OpenAI sign-in note. FIXED: pending right after the restart sentences.
- [NIT] Pid reuse during the settle. FIXED: comment.
- [NIT] A close gone by the settle still answers "Nothing was changed". RECORDED: #7470.

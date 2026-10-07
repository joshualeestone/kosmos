---
method: challenge-loop
branch: linux-systemd-4918
diff_hash: 3fdf3aa4381f59332f2eaabc4790c7f3e0f1651df178d40f1708631134aa1aa8
timestamp: 2026-10-07T02:58:17Z
converged: false
stopped_by: Splinter (PM), 2026-10-06 21:52 CDT, at STOP-ITERATION-VALVE (iteration 40)
---

# Challenge-loop proof: linux-systemd-4918 (#4918, Linux port piece B)

systemd user units keep agents and the board alive on Linux. Blind reviewers alternated Opus and Sonnet for 40
iterations. The loop did NOT converge: iteration 40 still found WARNINGs, and STOP-ITERATION-VALVE fired
(PAUSE STOP-ITERATION-VALVE - iteration count = 40). Splinter ruled at 21:52: stop iterating, merge once the
required Mac CI and the full validation are green, and file the open findings as one follow-up card (#5445).
The live check on real systemd passes (a killed agent is revived, a running agent's restart swaps the
supervisor, the board restarts after a crash, a stopped board stays stopped). Every FIXED finding with a
behaviour change carries a test that went red with its defect planted. All 25 source-sweep guard files pass.

#### Iteration 1
- [BLOCKER] engine/linuxjob.js:184 (BRANCH): no KillMode: stopping agent A kills the shared tmux server (every agent). FIXED: 4e1e30ea6
- [BLOCKER] engine/linuxjob.js:87 (BRANCH): '+' world separator in unit name: invalid systemd unit name. FIXED: 4e1e30ea6
- [WARNING] engine/linuxboard.js:133 (BRANCH): installBoard has no production caller. DEFERRED: piece D (#4920) installs Kosmos on Linux, so it installs the unit; plan says so
- [WARNING] engine/linuxjob.js:268 (BRANCH): start ignores daemon-reload/enable/linger results. FIXED: 4e1e30ea6
- [WARNING] engine/linuxjob.js:46 (BRANCH): systemctl bypasses DRY_RUN and the #1598 live gate. FIXED: 4e1e30ea6
- [WARNING] engine/linuxjob.js:107 (BRANCH): unit escaping: newline, backslash, %, $; model unvalidated. FIXED: 4e1e30ea6
- [WARNING] engine/delete-leftover.js:442 (BRANCH): remove swallows errors; false Trash promise on Linux. FIXED: 4e1e30ea6
- [WARNING] install/kosmos:1246 (BRANCH): installer tmux check changed on Mac too. FIXED: 4e1e30ea6
- [WARNING] engine/remove.js:540 (BRANCH): no tests of the Linux lifecycle wiring. FIXED: 4e1e30ea6
- [CONVENTION] .github/workflows/linux-systemd-4918.yml:7 (BRANCH): branch-named workflow; push never fires after merge, PR unfiltered. FIXED: 4e1e30ea6

#### Iteration 2
- [WARNING] engine/create.js:1253 (BRANCH): rewriteAgentJob unitFor throws outside try; reload result dropped. FIXED: 80fddba5c
- [WARNING] engine/create.js:5769 (SELF): create path drops the linger result. FIXED: 80fddba5c (visible step + outcome sentence)
- [WARNING] install/kosmos:1246 (BRANCH): board unit lacks AGENT_WORKFORCE_TMUX_BIN: restart loop on a system-tmux install. FIXED: 80fddba5c
- [WARNING] tools/test-linux-systemd-live-4918.sh:240 (BRANCH): live test never checks stop-stays-stopped, KillMode, board.stopped. FIXED: 80fddba5c (CI runs it)
- [WARNING] engine/linuxjob.js:334 (SELF): remove ok while a refused stop leaves the unit running. FIXED: 80fddba5c (+test, not-loaded control)
- [WARNING] engine/linuxboard.js:172 (BRANCH): MainPID parsed from human status text. FIXED: 80fddba5c (systemctl show)

#### Iteration 3
- [BLOCKER] engine/linuxjob.test.js:144 (BRANCH): tests write ~/work/workers/sonya (no sandbox). FIXED: 4f2b1c93c (3 files sandboxed; sonya + kenshi empty folders I created removed)
- [WARNING] tools/test-linux-systemd-live-4918.sh:281 (SELF): board.stopped check cannot fail (stub checks the marker). FIXED: 4f2b1c93c (ConditionResult=no)
- [WARNING] engine/remove.js:2220 (BRANCH): Linux restart failure says macOS launch job. FIXED: 4f2b1c93c
- [WARNING] engine/linuxjob.js:296 (SELF): NOT_LOADED matches the bus failure. FIXED: 4f2b1c93c (+test)
- [WARNING] engine/linuxjob.js:310 (BRANCH): disable result and removeBoard results ignored. FIXED: 4f2b1c93c (+test)
- [WARNING] engine/linuxjob.js:259 (BRANCH): unit file write has no test-process guard. FIXED: 4f2b1c93c (+test, control)

#### Iteration 4
- [WARNING] engine/linuxjob.js:351 (SELF): NOT_LOADED misses "Unit file X does not exist". FIXED: b10bf532d (+exact-wording test)
- [WARNING] engine/linuxjob.js:339 (BRANCH): loaded() unguarded stdout. FIXED: b10bf532d
- [WARNING] install/kosmos _kosmos_board_supervised (BRANCH): supervised by cat alone; disabled unit counts. FIXED: b10bf532d (is-enabled + shell test)
- [WARNING] install/kosmos cmd_stop (BRANCH): refused systemctl stop hidden. FIXED: b10bf532d (say)
- [WARNING] engine/create.js:5807 (SELF): linger step ok:false on loginctl missing. DEFERRED: reviewer traced no break; the sentence is right
- [WARNING] .github/workflows/linux-systemd.yml:38 (BRANCH): /run/user pre-created before logind. DEFERRED: the workflow passed on GitHub's runners (3 runs today)
- [WARNING] .github/workflows/linux-systemd.yml:3 (SELF): paths filter misses launchidentity/accountenv/live-execution. FIXED: b10bf532d
- [WARNING] tools/test-linux-systemd-live-4918.sh (BRANCH): live script never asserts engine results. FIXED: b10bf532d
- [CONVENTION] (plan) (BRANCH): named-world unit never exercised live. FIXED: b10bf532d (live named-world check)

#### Iteration 5
- [WARNING] engine/linuxjob.js:24 (BRANCH): sandbox (AGENT_WORKFORCE_LAUNCH) ignored: real units from a sandbox board; HOME=os.homedir. FIXED: f93294407 (+test)
- [WARNING] engine/worldstarts.js:277 (BRANCH): world switch on Linux: jobSwitchState has no Linux arm, nothing paused. FIXED: f93294407 (is-enabled; +test)
- [WARNING] install/kosmos:869 (BRANCH): tr fallback outside the pipe hangs. FIXED: f93294407
- [WARNING] tools/test-linux-systemd-live-4918.sh (BRANCH): live gaps: Condition fresh start; installer start/stop; self-restart; create wiring. FIXED (part): f93294407 Condition start check + create.linux test; installer/self-restart DEFERRED to D's workflow (plan)

#### Iteration 6
- [WARNING] engine/remove.js:536 (SELF): Linux jobOps bypass remove's run (setRunner/DRY_RUN/live gate). FIXED: 823a651e9 (runWith; dry-run test; mutant red)
- [WARNING] engine/linuxjob.js:56 (BRANCH): 5 s systemctl timeout shorter than a stop (supervisor sleep 10 s). FIXED: 823a651e9 (30 s)
- [WARNING] tools/test-linux-systemd-live-4918.sh (BRANCH): live: linger, real board-run, kosmos start/stop. DEFERRED: piece D's workflow runs the real install and kosmos (plan)
- [WARNING] engine/create.js:3333 (BRANCH): disabledJobsResult/runningJobs launchctl-only on Linux. DEFERRED: display parity, follow-up card after B (plan)
- [WARNING] engine/create.js:4695 (SELF): name-taken lj.loaded bypasses create's run/DRY_RUN. FIXED: 823a651e9

#### Iteration 7
- [BLOCKER] engine/create.js:4693 (SELF): name check through create.run throws on is-active exit 3: every Linux create crashes. FIXED: 0835a9cd6 (linuxRun; execFileSync-shaped fake; mutant reds 3)
- [WARNING] engine/delete-leftover.js:440 (SELF): Linux removal skips delete-leftover's run seam. FIXED: 0835a9cd6
- [WARNING] engine/create.js:5767 (BRANCH): start/linger/rollback skip create's run. FIXED: 0835a9cd6 (linuxRun)
- [WARNING] engine/create.js:4710 (BRANCH): loaded unit with no file: dead-end advice. FIXED: 0835a9cd6 (systemctl --user stop sentence; test)
- [WARNING] engine/linuxjob.js:186 (BRANCH): RestartSec=5 vs launchd pace; persistent-fault loop. FIXED: 0835a9cd6 (RestartSec=10)

#### Iteration 8
- [WARNING] engine/remove.js:2166 (BRANCH): Linux restart reports success when the stop was refused. FIXED: 2fbc5b5d2 (held; test; mutant red)
- [WARNING] engine/create.js:5795 (BRANCH): start failure reason and unitSafe refusal swallowed. FIXED: 2fbc5b5d2
- [WARNING] engine/linuxboard.js installBoard (BRANCH): no production caller. DEFERRED: dup of #3 (piece D)
- [WARNING] engine/remove.js jobOps (BRANCH): restore ignores the record's label world. FIXED: 2fbc5b5d2 (worldFromUnitName; test)

#### Iteration 9
- [WARNING] engine/remove.js:550 (SELF): restart's startNow re-enables (a removed agent returns at boot). FIXED: 435603d47 (startOnly; test; mutant red)
- [WARNING] engine/create.js:1195 (BRANCH): malformed unit gives "(undefined)" sentence. FIXED: 435603d47 (+test)

#### Iteration 10
- [WARNING] engine/worldstarts.js:287 (SELF): jobSwitchState Linux arm on linuxjob's own runner. FIXED: 15378f928 (create.linuxRun; test)
- [WARNING] install/kosmos:874 (BRANCH): shell vs JS unit-name normalization ('..', relative). FIXED: 15378f928 (logical resolve; physical cwd for relative; 3 cross-checks)

#### Iteration 11
- [WARNING] engine/register.js:177 (BRANCH): register survey + status stat check plistPath on Linux. FIXED: d69f8e956 (+test)
- [WARNING] engine/linuxjob.js:236 (SELF): RestartSec=30 is not ThrottleInterval semantics. FIXED: d69f8e956 (5 s backing off to 30 s)
- [WARNING] engine/create.js:1268 (SELF): rewrite reload refusal after the new file is written. FIXED: d69f8e956 (write only; test)
- [WARNING] engine/linuxjob.js:232 (BRANCH): exit 143 on stop leaves units failed. FIXED: d69f8e956 (SuccessExitStatus)
- [CONVENTION] plan (SELF): timeout figure not uniform. FIXED: d69f8e956
- [CONVENTION] engine/linuxjob.js:25 (BRANCH): defaults pasted four times. FIXED: d69f8e956 (defaultSystemdDir/realRunner shared)

#### Iteration 12
- [WARNING] install/kosmos:1343 (BRANCH): clean board-run exit (port busy) not retried under on-failure. DEFERRED: known limit in plan: Linux starts the board only through systemd (D); kosmos start recovers
- [WARNING] engine/linuxboard.js:108 (BRANCH): installBoard never ensures linger. FIXED: 3a349ac70 (+test)

#### Iteration 13
- [WARNING] engine/linuxjob.js:56 (SELF): XDG fallback only in linuxjob.realRunner. FIXED: c5db408dc (ensureRuntimeDir on all paths + installer)
- [WARNING] engine/linuxjob.js:186 (SELF): RestartSteps counter may never reset. FIXED: c5db408dc (constant 10 s)
- [WARNING] tools/test-linux-systemd-live-4918.sh (BRANCH): live check never drives create/restart/remove wiring. FIXED: c5db408dc (live createAgent->restart->remove; workflow unit step)

#### Iteration 14
- [WARNING] engine/linuxboard.js:99 (BRANCH): port-busy clean exit not retried. DEFERRED: known limit (kernel releases listen socket on death; Mac exit code pinned)
- [WARNING] engine/remove.js held (SELF): never-loaded unit stop read as refused. FIXED: 9f67a1db2
- [WARNING] engine/linuxjob.js:230 (SELF): SuccessExitStatus comment overclaims. FIXED: 9f67a1db2
- [WARNING] engine/boardrestart.js:65 (BRANCH): setInstalledCli seam widened (Mac-visible). FIXED: 9f67a1db2 (reverted; tests pass functions)
- [CONVENTION] engine/linuxjob.js:211 (BRANCH): Description not unitSafe. FIXED: 9f67a1db2

#### Iteration 15
- [WARNING] tools/test-linux-systemd-live-4918.sh:228 (SELF): live remove accepts PARTIAL, no systemd check. FIXED: f6c422c09
- [WARNING] engine/worldstarts.js:558 (BRANCH): import failed-start promises next login when enable refused. FIXED: f6c422c09 (atLogin)

#### Iteration 16
- [WARNING] engine/linuxboard.js:79 (BRANCH): board unit logs only to journal; installer points at board.log. FIXED: 3fffd3ab0
- [WARNING] live/workflow (BRANCH): real cmd_start/stop/self-restart not live. DEFERRED: dup of D deferral (plan)
- [WARNING] engine/create.js:5046 (BRANCH): rollback ignores stop result, deletes unit file. FIXED: 3fffd3ab0 (lj.remove)

#### Iteration 17
- [WARNING] engine/createdroster.js:115 (BRANCH): .plist-only created-agent listings (board, createdKeys, stray sweep) on Linux. DEFERRED: display parity, recorded in the plan's follow-up card (not a regression)

#### Iteration 18
- [CONVENTION] engine/create.js:4713 (BRANCH): win32 path change unstated in plan. FIXED: 85cfdc2a2 (plan note)

#### Iteration 19
- [WARNING] engine/linuxjob.js:29 (BRANCH): units follow the board's XDG_CONFIG_HOME, not the manager's. FIXED: e1433a7fb (~/.config; test)

#### Iteration 20
- [WARNING] engine/linuxjob.js:393 (SELF): NOT_LOADED English-only. FIXED: 8858e7345 (exit 5; test)
- [WARNING] engine/linuxjob.js:233 (BRANCH): append: needs systemd>=240, unstated. DEFERRED: plan states minimum; version check belongs in D's installer
- [WARNING] engine/create.js:5812 (SELF): raw systemd stderr in the sentence. FIXED: 8858e7345 (plain bus sentence)
- [WARNING] .github/workflows/linux-systemd.yml (BRANCH): path-filtered workflow; installer start/stop not live. DEFERRED: plan states the remaining coverage (D)

#### Iteration 21
- [WARNING] engine/linuxjob.js:28 (SELF): sandboxed board acts on real units by name. FIXED: fea81d114 (refuse; test)
- [WARNING] engine/remove.js:529 (BRANCH): dry-run Linux loaded reads false -> PARTIAL. FIXED: fea81d114

#### Iteration 22
- [WARNING] engine/linuxboard.js:35 (SELF): board runner lacks the sandbox refusal. FIXED: 57fad65c9 (test, planted red)
- [WARNING] engine/linuxjob.js:135 (BRANCH): linger by $USER. FIXED: 57fad65c9 (uid; test)
- [WARNING] tools/test-linux-systemd-live-4918.sh (BRANCH): real installer not exercised live. DEFERRED: dup of row 82; plan states it (D)
- [WARNING] install/kosmos cmd_stop (BRANCH): no-pid stop leaves unit inactive. DEFERRED: stop holds via board.stopped; plan note; D owns installer

#### Iteration 23
- [BLOCKER] engine/linuxjob.js:399 (SELF(it21)): dry-run-as-loaded refused every dry-run Linux create. FIXED: d193c741c (moved to remove; test planted red)
- [WARNING] engine/create.js:3743 (BRANCH): start of active unit reported started now. FIXED: d193c741c (test planted red)
- [WARNING] engine/worldstarts.js:277 (BRANCH): launchctl print-disabled on Linux. FIXED: d193c741c
- [CONVENTION] tools.every-test-runs.test.js:53 (BRANCH): stubbed supervised shell test MANUAL, not in main suite. FIXED: 29e7b45f8 (wired into test:shell; ALL PASS on Mac)

#### Iteration 24
- [WARNING] engine/linuxjob.js:134 (BRANCH): linger read-back race. FIXED: 5c1d832b0 (logind file fallback outside tests)
- [WARNING] engine/create.js:4717 (BRANCH): failed unit not name-taken. DEFERRED: not an issue: re-create replaces a failed unit; plan records it
- [WARNING] .github/workflows/linux-systemd.yml:22 (BRANCH): path filter gaps. DEFERRED: dup of row 82 (status.js IS in the filter, verified)

#### Iteration 25
- No BLOCKER, WARNING or CONVENTION. Two NITs fixed (a false "could not start" sentence for an agent systemd already
  had loaded; the live script's cleanup of the create/restart/remove unit), so iteration 26 reviewed them.

#### Iteration 26
- [WARNING] engine/linuxjob.js:92 (BRANCH): sandbox refusal sentence. DEFERRED: decided (review 21); sentence names the reason; plan
- [WARNING] engine/create.js:5117 (BRANCH): linger left on after failed create. DEFERRED: by design; D's installer states it; plan
- [WARNING] engine/linuxjob.js:408 (BRANCH): dangling wants link unreported. DEFERRED: systemd ignores it; plan
- [WARNING] tools/test-linux-systemd-live-4918.sh:231 (BRANCH): live restart never on a running unit. FIXED: 3e6176d06 (MainPID must change)
- [CONVENTION] plan (BRANCH): plan history-heavy, limits hard to audit. FIXED: acc280e73 (summary at top)

#### Iteration 27
- [WARNING] tools/test-linux-systemd-live-4918.sh:246 (SELF(it26)): set -e kills before LIVE_RC; skips board checks. FIXED: 058884f7f
- [WARNING] engine/create.js:6030 (BRANCH): nameHeld plist-only; bus-down rollback orphan. FIXED: 058884f7f (tests planted red)

#### Iteration 28
- [WARNING] engine/linuxjob.js:62 (BRANCH): localized disable of a missing unit -> remove fails forever. FIXED: a0736ae9f (hadFile; test planted red)
- [WARNING] engine/linuxjob.js:372 (BRANCH): status() stdout unguarded. FIXED: a0736ae9f
- [WARNING] engine/linuxboard.js:106 (BRANCH): board unit lacks SuccessExitStatus=143. FIXED: a0736ae9f

#### Iteration 29
- [WARNING] engine/linuxboard.js:154 (SELF(it28 incomplete)): removeBoard localized disable. FIXED: e1134537e (test planted red)
- [CONVENTION] engine/linuxjob.js:165 (BRANCH): port derived twice. FIXED: e1134537e (create.boardPort)

#### Iteration 30
- [WARNING] engine/delete-leftover.js:303 (BRANCH): Linux folder+unit deleted for good with Mac wording. FIXED: 214dbb691 (honest wording; review-1 decision kept; test planted red)
- [WARNING] engine/linuxjob.js:303 (BRANCH): readUnitJob reads back configDir only. DEFERRED: parity with readPlistJob; plan

#### Iteration 31
- [WARNING] engine/create.js:4663 (SELF(it27)): orphan-unit refusal advice unfollowable on Linux. FIXED: 9f3cd3371 (command in sentence; test)
- [WARNING] engine/delete-leftover.js:290 (BRANCH(it1 decision)): unit forces folder deleted for good; bus-down loses folder. FIXED: 9f3cd3371 (reverses review 1; tests planted red)
- [CONVENTION] .github/workflows/linux-systemd.yml (BRANCH): filter omits teamseed/createdroster. FIXED: 44f9f886d

#### Iteration 32
- [WARNING] engine/delete-leftover.js:305 (SELF(it31)): unit-only leftover promised the Trash. FIXED: 0b338a17f (test planted red)
- [WARNING] engine/delete-leftover.js:469 (SELF(it31)): Trash + stuck unit still moved folder. FIXED: 0b338a17f (test planted red)
- [WARNING] engine/remove.js:698 (BRANCH): jobFor plist: unit trap. FIXED: 0b338a17f
- [CONVENTION] tools/test-linux-systemd-live-4918.sh:12 (BRANCH): CI-only guard weak. FIXED: 0b338a17f (+GITHUB_ACTIONS)

#### Iteration 33
- [WARNING] engine/delete-leftover.js:472 (SELF(it31/32)): keep-folder rule changed Windows tasks too. FIXED: c9639d414 (unit only)
- [WARNING] engine/remove.js:1855 (BRANCH): Linux restore with gone unit says start by hand. FIXED: c9639d414 (test planted red)

#### Iteration 34
- [WARNING] engine/delete-leftover.js:470 (BRANCH): forget/tokens run after kept folder. FIXED: cc73fe506 (it35 re-raised; early return)
- [WARNING] engine/delete-leftover.js:489 (SELF(it31)): PARTIAL wording says could not move. FIXED: ea3a48755 (test)
- [WARNING] engine/linuxjob.js:395 (BRANCH): dangling wants link. DEFERRED: dup of row 98
- [WARNING] engine/register.js:425 (SELF(it25)): repair undercounts alreadyRunning. FIXED: ea3a48755 (test planted red)
- [WARNING] install/kosmos:1265 (BRANCH): TMUX_BIN trusted. DEFERRED: main trusts an explicit choice; plan
- [CONVENTION] package.json:16 (SELF(it23)): no bash -n for the Linux shell tests. FIXED: ea3a48755

#### Iteration 35
- [WARNING] engine/delete-leftover.js:470 (SELF(it34 deferral)): forget/tokens after kept folder. FIXED: cc73fe506 (dup of 120, reversed)
- [WARNING] engine/create.js:5592 (BRANCH): unitSafe refusal hidden at creation. FIXED: cc73fe506 (test planted red)

#### Iteration 36
- [WARNING] tools/test-linux-systemd-live-4918.sh:15 (BRANCH): REPO unused, cwd-relative requires. FIXED: e09f748d8
- [WARNING] engine/create.js:5059 (BRANCH): linger enabled silently on repair. DEFERRED: dup of row 97 (decided; D's installer states it)

#### Iteration 37
- [WARNING] engine/create.js:3745 (SELF(it25)): alreadyRunning wins over a refused enable. FIXED: 34c5122bb (test planted red)
- [WARNING] engine/delete-leftover.js:176 (SELF(it35)): refused delete hides the standing reset. FIXED: 34c5122bb (test)

#### Iteration 38
- [WARNING] install/kosmos:1265 (BRANCH): kosmos start on supervised Linux board dies on tmux check. DEFERRED: piece D owns the Linux tmux pick; plan claim corrected (bfc95b5fd)
- [WARNING] .github/workflows/linux-systemd.yml:2 (BRANCH): hand-maintained filter. DEFERRED: dup of rows 82/113
- [WARNING] engine/linuxjob.js:133 (BRANCH): linger file fallback untested. DEFERRED: gated off in tests on purpose; linger-off untested live (plan)

#### Iteration 39
- [WARNING] engine/worldstarts.js:558 (SELF(it25/37)): import calls a running agent unstarted/held. FIXED: 35f3ac601 (test planted red)

#### Iteration 40
- [WARNING] engine/delete-leftover.js:445 (SELF(it35)): unit-only stuck still forgets records. FIXED: 0ca5782d7 (test planted red)
- [WARNING] engine/create.js:5131 (BRANCH): tmux session outlives Linux rollback. DEFERRED: unconfirmed; measure on Linux lane; plan follow-up
- [WARNING] tools/test-linux-systemd-live-4918.sh:28 (BRANCH): degraded user manager fails live job. FIXED: 0ca5782d7

#### Outside the loop
- [WARNING] engine/linuxjob.js:145 (SELF(it24)): windows-coupling-audit flags linger path (Angel's re-read, Splinter 20:22). FIXED: 55a4a49ff (inventory row)

### Final Ledger
- 137 rows; iterations with no BLOCKER/WARNING/CONVENTION rows (NITs only): 25.
- Open findings at the stop: filed as #5445, linked from #4984 and #4903.
- converged: false (stopped by the PM's ruling, not by a clean iteration).

# win-usage-tests-7247: a Windows test run is kept off the real Task Scheduler by itself; the usage reading measured

**Posture:** production

Card: #7247 (from an agent's feedback, filed by Splinter). Two asks.

## Done when
- On a Windows computer that is not CI, `node tools/windows-tests.js` and `npm test` (tools/run-tests.sh) load the
  schtasks guard without being asked, and say so in one line; CI and `KOSMOS_TESTS_REAL_SCHTASKS=1` are unchanged.
- The guard lives in the repo (`tools/no-schtasks-preload.cjs`) and is documented beside tools/windows-tests.js.
- Ask 1 is answered with measurements, and any change it needs is named, not guessed.

## Ask 1: the usage reading "never refreshes on Windows" (measured, no code change)
On the Windows box (0.7.69), 2026-10-26: the board served the weekly reading live (25%, measured 3 minutes earlier).
The status line records it whenever an interactive agent on the account takes a turn. It goes stale only when headless
agents alone use an account, and that holds on every platform. The poller for idle and headless-only accounts
(#7152, engine/usagepoll.js) was run once on this box with origin/main's code: it read `.credentials.json` and measured
25%, state `ok`. It is off by default everywhere (`AGENT_WORKFORCE_USAGE_POLL=1`). Whether the Windows board turns it on
is a board-task setting that follows what the Mac boards do; asked on the card, not changed here.

## Ask 2: the schtasks guard
- `tools/lib/schtasks-call.cjs` (pure): whether a call RUNS schtasks. schtasks is the program (any path, case, .exe or
  not), or cmd/powershell/pwsh start it, or a shell command line (exec, execSync, shell: true) starts it in any of its
  commands (split at & | ; parentheses and line ends outside quotes). The word anywhere else (a git grep pattern, a
  commit message, a script's source) is not a call. Kosmos itself always runs `schtasks.exe` as the program (checked
  in engine/); it reaches the scheduler no other way (no PowerShell ScheduledTasks cmdlets in engine/, server.js or tools/).
- `tools/no-schtasks-preload.cjs`: a call that runs schtasks is sent to a program that cannot exist
  (`REFUSED_PROGRAM`, which names the refusal), with no shell. So EVERY arm fails exactly as a missing schtasks.exe
  would, with Node's own ENOENT: sync calls throw or return it, async ones emit 'error' (with their streams) and call
  back with it, and promisify rejects with it. Every other call goes to Node unchanged. The execFile and exec wrappers
  carry `util.promisify.custom`, as test-support/tool-guard.js does: without it promisify(execFile) resolves a bare
  string for EVERY command (#4326 hit this; review 1). `KOSMOS_SCHTASKS_BLOCK_LOG` logs each refusal.
- `tools/windows-tests.js`: `guardsScheduler(env, platform)`, `childEnv(env, platform)` and `schedulerLine(env, platform)`.
  win32 and not CI and not `KOSMOS_TESTS_REAL_SCHTASKS=1` adds `--require "<this checkout's preload>"` to NODE_OPTIONS
  (kept; not added twice; another copy of a preload does not count), passed to each test file's process, so its
  children inherit it. A Windows run prints which scheduler it uses either way.
- `tools/run-tests.sh`: on MINGW/MSYS/Cygwin it runs `childEnv` and `schedulerLine` from tools/windows-tests.js through
  node, so the rule is written once (review 1). Without `cygpath` the guard cannot be set up, and the run stops (exit
  2) rather than reach the real scheduler, unless CI or `KOSMOS_TESTS_REAL_SCHTASKS=1` asked for it.
- Forward slashes: measured on the box, NODE_OPTIONS reads a backslash inside quotes as an escape, so
  `--require "C:\Users\..."` fails to load and `--require "C:/Users/..."` loads.

## Measured: how many real schtasks calls (the card's premise)
On the Windows box, 2026-10-26, with the guard on and `KOSMOS_SCHTASKS_BLOCK_LOG` set:
- `node tools/windows-tests.js` (197 files): 1 call refused in the whole set, from this branch's own test (its probe named
  schtasks on its own command line; fixed). Four sampled win32 files that drive scheduler code (agystatus, job-read,
  launch-570, jobexists) stub their own calls: 0 refused.
- `npm test` (tools/run-tests.sh) cannot run on Windows at all: line 845 passes every file on one node command line and
  bash stops with "Argument list too long". Before that it refuses on its harness and suite probes, which exit 2 here
  (KOSMOS_TESTS_IGNORE_HARNESS=1 and KOSMOS_TESTS_IGNORE_SUITE=1 pass them).
- Plain `node --test` discovery over the repo hung after about 10 minutes (8 test processes idle for 50 minutes) and
  was stopped. In that time it refused 2 calls, both from this branch's test.
So "thousands of real calls" is not reproduced on current code. It describes runs before more of the scheduler code
got seams. The guard stays: it costs nothing when nothing calls schtasks, and one test that does reach the live
scheduler on this box could end the board's task. The Windows `npm test` limit is #7257, not fixed here.

What already refuses: engine/win32job.js `run()` refuses real schtasks in any process that is a test run
(`schtasksMayRunInThisProcess` -> `live-execution.inTestRun()`, NODE_TEST_CONTEXT included), which is very likely why
the count is near zero. This guard is the layer under it: it catches a test's own raw child_process call to schtasks,
any code that reaches schtasks other than through win32job, and a child started without NODE_TEST_CONTEXT that keeps
NODE_OPTIONS. win32job's refusal stays the primary one for Kosmos's own scheduler code.

## Rejected
- Reusing test-support/tool-guard.js's command-position reader (review 5): it is tied to its own verdict (a "real
  install" of gh/vercel/cloudflared, judged by PATH and the repo and temp roots), pinned by its own test, and reads no
  Windows launchers (quoted cmd /c, -EncodedCommand, call, start, nesting). Merging the two readers would change a
  guard other tests depend on, inside a card about something else. One shared reader is #7262. Weakest part: until
  then the two can drift.
- Refusing to run without the guard: the runner can apply it itself, and a refusal only adds a step for the person.
- Applying it on CI: the runner is throwaway, and windows.yml's KNOWN_RED list is measured against the real scheduler.

## Weakest part, named
"Not CI" is read from the `CI` variable. A developer who sets CI locally gets the real scheduler; the run says so in
one line ("REAL Task Scheduler (CI is set)"). The bigger gap: a test that starts a process with an environment of its
own that replaces NODE_OPTIONS or leaves it out runs that process unguarded (round 3; the reason it stays is under
Review rounds). And the matcher reads a shell command line with a small tokenizer, not a shell parser: an unusual
form could hide a schtasks call from it (its header lists the ones known). Kosmos's own calls never go through a shell.

## Tests
`tools.windows-tests-schtasks-7247.test.js` (every platform; selected by windows-tests.js as tools.windows-*):
- the env rule both ways with controls; NODE_OPTIONS kept, not doubled, another copy not counted; the printed line.
- the matcher: programs by path and case, cmd /c, powershell -Command, shell: true, chained commands; and the word in
  a git grep, a commit message, a script's source, `echo schtasks`, `node -e "require('schtasks')"` NOT refused.
- every arm in a real child that loads the preload as the runner does: execFileSync, spawnSync, execSync, spawn (with
  its streams), execFile, exec and promisify(execFile) all give ENOENT; another program runs; promisify(execFile) and
  promisify(exec) still resolve `{ stdout, stderr }`. CONTROL: the same arms aimed at a program no computer has, with
  no preload, give the same ENOENT. Negative control: against the previous preload the arms test fails.

## Review rounds (fleet cap: 8, unless a BLOCKER is open)
- Round 1: no BLOCKER. Fixed: promisify shape (the wrappers dropped util.promisify.custom); the word schtasks in an
  argument was refused (now only calls that RUN it); async refusals unlike a missing program (now Node's own ENOENT);
  thin tests; comments repeating the unreproduced "thousands" claim; the rule written twice (run-tests.sh now runs the
  JS rule); another copy of the preload counted as this one; no cygpath fell back to a path node cannot load (now
  stops); the run was silent when the guard was off (now prints either way).
  Verified after round 1: install.reachable-1662 (16 pass / 30 fail) and cli.connections-4451 (1 / 5), both of which
  call promisify(execFile), give identical counts with and without the guard on this box (their reds are this box's
  baseline); windows-tests-1777 23/23; this file 8/8.
- Round 2: no BLOCKER. Fixed: quoted shell forms (cmd /c "schtasks ...", powershell -Command "...") slipped through, and
  so did value-taking PowerShell switches (-ExecutionPolicy Bypass) and start /b; the matcher is now a small tokenizer
  that walks past cmd, powershell/pwsh, call and start (nested, quoted), decodes -EncodedCommand, and stops at
  -File (a script it cannot read, named in its header). run-tests.sh's bridge is tested with the node snippet read
  out of run-tests.sh itself. NITs taken: an explicit undefined args slot; one split per call; the header says the
  shell arms fail with ENOENT, not a shell's status, and that the log holds command lines; CI=false and CI=0 are not
  CI. Negative control: against round 1's code the two new behaviour tests fail. This file 11/11; with
  windows-tests-1777 34/34; under the guard 0 fail.
- Round 3: no BLOCKER. Fixed: a refused call with null or undefined in its options slot lost its callback (a guarded
  test would hang rather than see ENOENT); the probe now covers execFile and exec with both (against round 2's preload
  the arms test fails). Decided, not changed: a process started with an environment of its own that leaves
  NODE_OPTIONS out runs unguarded, as does everything it starts. Re-adding the preload there was rejected because
  those callers strip NODE_OPTIONS on purpose (engine/manifest-verify.js does, and tests check that env); it is now
  said in the preload's header and in the runner's comment, and it is the guard's main gap (see Weakest part). The
  matcher's header lists what it does not read (script blocks, Start-Process, cmd /c with no space). 34/34 with
  windows-tests-1777.
- Round 4: no BLOCKER. Fixed: run-tests.sh's no-cygpath fallback read CI=false as CI (now read as onCi does, and it
  prints the REAL-scheduler line when it goes on unguarded); bash, sh (with -c, -lc, -ec) and env in front of schtasks
  were not read, and tests do start bash -c (Git Bash's is an MSYS program NODE_OPTIONS never reaches); the docs said
  npm test "cannot reach" the scheduler, now "every node process" with test:shell's bash scripts named as unguarded.
  NITs taken: a source check that main() hands each file childEnv's env; one shared options-then-tail helper; the
  matcher's header names a lone apostrophe in a cmd line, wsl and npx. Negative control: against round 3's matcher and
  run-tests.sh the two new behaviour tests fail. 37/37 with windows-tests-1777; under the guard 0 fail.
- Round 5: no BLOCKER. Fixed: zsh, dash, ksh and fish read as sh is, and -o/+o options (which take a value) no longer
  end the scan (against round 4's matcher the new test fails); seven win32 test headers named the outside copy of the
  preload and now name tools/no-schtasks-preload.cjs; the env gap now says "replaces NODE_OPTIONS or leaves it out".
  Answered in the plan: what win32job.js already refuses and what this layer adds. Decided: a second command reader
  beside tool-guard's, with the reasons under Rejected; one shared reader is #7262. NIT taken: the matcher's header
  names its known false positive (a parenthesis: "echo (schtasks)"). 38/38 with windows-tests-1777.

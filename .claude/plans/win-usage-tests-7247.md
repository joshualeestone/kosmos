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
- `tools/no-schtasks-preload.cjs`: the box's preload, moved into the repo unchanged in behaviour. Any child_process
  call naming schtasks is refused as ENOENT; `KOSMOS_SCHTASKS_BLOCK_LOG` logs each one. Kosmos reaches the scheduler
  only through schtasks.exe (no PowerShell ScheduledTasks cmdlets in engine/, server.js or tools/: checked).
- `tools/windows-tests.js`: `guardsScheduler(env, platform)` and `childEnv(env, platform)`. win32 and not CI and not
  `KOSMOS_TESTS_REAL_SCHTASKS=1` adds `--require "<preload>"` to NODE_OPTIONS (kept, not added twice), passed to each
  test file's process, so its children inherit it.
- `tools/run-tests.sh`: the same rule for MINGW/MSYS/Cygwin, with `cygpath -m` for the path.
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

## Rejected
- Refusing to run without the guard: the runner can apply it itself, and a refusal only adds a step for the person.
- Applying it on CI: the runner is throwaway, and windows.yml's KNOWN_RED list is measured against the real scheduler.

## Weakest part, named
"Not CI" is read from the `CI` variable. A developer who sets CI locally gets the real scheduler; the runner prints
which mode it ran in only when the guard is on, so that run is silent about it.

## Tests
`tools.windows-tests-schtasks-7247.test.js` (pure rule on every platform; selected by windows-tests.js as tools.windows-*):
the env rule both ways with controls, NODE_OPTIONS kept and not doubled, and a real child process started with that
environment has schtasks refused by spawnSync and execFileSync while another program still runs. Control by hand on
the box: the same call without the preload reaches the real schtasks.

# win-skip-macos-tools-8378: Mac and Linux-only tooling and Windows-off features skip on Windows (kosmos#8378, triage batch 2)

**Posture:** production

## Problem
From #8378's triage of the 40 heaviest Windows-failing files: 12 files whose failures on Windows are tools or features
that do not exist there by design: the Mac release cut (tools/release.sh), Mac fleet ops tools (serve-watch, gap-alarm),
the Mac-side Windows publish tool, the Mac/Linux installer (install/setup.sh through sh -c), the Linux systemd board
install, the tmux socket folder under process.getuid(), the POSIX agent supervisor (bin/agent-supervisor.sh), a bash codex
mock with a TERM trap, and two features off on Windows by design (the Codex org-chart reader, WHY_WINDOWS; agent-event
reporting, whose tick returns early on win32).

## Change (test-only; no production code)
- Each file: file-level skipOnWin32 constants naming the mechanism, on the tests that need the missing subject (merged
  into existing options; existing timeouts and skips kept). Tests in these files that do not need it (source reads,
  Windows arms) keep running.
- Fixes, not skips: engine/agentevents-5683 sessionOf input built with path.join (it assumed POSIX paths);
  engine/openaiaccounts.chatgpt-reauth-2584 three "refused up front" tests use process.execPath as the runner (the bash
  mock failed the runner check before the refusal they test). 4 tests now pass on Windows.
- tools/windows-tests.js: 12 HOST_BRANCH_EXCLUDED entries after the tools.prove-it-fails-restore-7619 entry.

## Measured on the Windows box (pass/fail/skip after; all were failing before)
release-gate 2/0/69, serve-watch 13/0/37, gap-alarm 8/0/16, publish-windows-2008 1/0/17, install.reachable 7/0/39,
install.linux-board 10/0/22, engine/status 227/0/17, supervisor.provider-key-inject 1/0/21, openaiaccounts-reauth 3/0/18,
orgchartcodex 10/0/28, manipcheck 32/0/53, agentevents 79/0/50.

## Review round 1
- Two orgchartcodex tests that fake Windows were skipped whole; only their off-Windows controls need a host where the
  reader is on. They now run on Windows with only the controls guarded (orgchartcodex 12/0/26). The review-8 test, which
  never fakes Windows, stays skipped.
- The agentevents reason names commands and file paths (some tests classify Read/Edit targets, not bash commands).
- Note: none of these 12 files is in the Windows CI job (all are in HOST_BRANCH_EXCLUDED), so the fixes and the tests
  that now pass on Windows are proved by runs on the box, not by Windows CI.

## Notes (not bugs in shipped Windows code)
- engine/agentevents.js reads birthtimeMs, which utimesSync does not move on NTFS: a manipcheck test would still fail on
  Windows if the tick ran there (code reading only). For whoever builds agent events on Windows.
- engine/status.js tmuxSaidNoServer and tools/gap-alarm.js call process.getuid() unguarded; neither runs on Windows (no
  tmux there; gap-alarm is a Mac launchd tool); status.js catches it.
- install.reachable: sh -c of a long script dies on its way through the Windows command line to Git Bash (test harness;
  setup.sh is not used on Windows).

## Done when
- The 12 files run 0 failed on the box; policy tests green; Mac/Linux CI green.

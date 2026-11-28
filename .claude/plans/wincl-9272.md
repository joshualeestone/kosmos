# wincl-9272: the org chart and team-create tests run on Windows (kosmos#9272)

## Finished looks like
engine/orgchartfile.test.js and teamcreate-structure-4557.test.js run in the Windows CI job (tools/windows-tests.js,
ALSO and ALSO_ROOT) and pass there, with every test whose subject exists on Windows running, and a skip only where
the setup itself cannot exist on Windows, with its Windows arm beside it.

## What was measured (GitHub's Windows runner, never-merged branch wincl-9272-never-merge)
- At main: orgchartfile 4 failing (three #!/bin/sh claude stand-ins, and #4660), teamcreate 7 failing.
- After this branch (run on d61c4f1fd6): orgchartfile 54 pass, 3 failing (the three #!/bin/sh arms, now skipped);
  teamcreate 7 of 7 pass.
- The real Windows job (windows.yml) on this branch: recorded on the card when it finishes.

## What changed
1. engine/orgchartfile.js: setClaudeLaunchForTest, a test-only hook for what the real Claude call starts, as
   [file, args]. Default is the real launch; nothing in production sets it.
   Rejected first, measured: a node binary standing in as claude, with the stub loaded by NODE_OPTIONS=--require.
   node refuses claude's flags before any preload runs ("bad option: --tools"). A .cmd stand-in: execFile refuses a
   .cmd without a shell since Node's CVE-2024-27980 fix (PigeonPete's note on the card).
2. Three #9272 tests at the end of engine/orgchartfile.test.js, the Windows arms of the three #!/bin/sh arms: a
   stream-json answer is read (and the reader's own flags and stdin reach claude), a too-old Claude Code says so
   (with a control that other words read "did not answer"), and CLAUDE_CONFIG_DIR is unset on the default account
   and passed on the board's own. They run on every platform. Mutation control: making the default account pass a
   CLAUDE_CONFIG_DIR turned the third red.
3. The three #!/bin/sh arms skip on Windows by skipOnWin32, naming the shebang and the #9272 test that is their
   Windows arm. They stay on the Mac: they run a real executable through execFile, which the hook skips.
4. #4660 is a fix, not a skip: it compared an account row's '/tmp/x-claude' with path.resolve of the same string,
   which is D:\tmp\x-claude on Windows. The row now holds the resolved path, as accounts.list() emits it.
5. teamcreate-structure-4557: on Windows, where.exe for the binaries, an empty roster through status.setPaneSource
   before each test (fleet.install's restore resets the seam to null, which on Windows reaches no tmux), and the
   win32job / win32create seams from engine/create.apostrophe-8784.test.js so no real Scheduled Task is made. req 1
   swaps the agent's folder in both separators. macOS and Linux are unchanged.

## Coordination
PigeonPete's wincl3b-8378 had skipped these arms naming this card; he dropped his edits to both files (2026-11-28
02:43) so this branch owns them. Expect an add/add in HOST_BRANCH_EXCLUDED / ALSO with his branch; keep both sides.

## Weakest premise
That a node script started through the hook covers what matters on Windows. It does not cover execFile launching a
real claude.exe there; that is Node's and Windows', and no test here can stand in a real .exe.

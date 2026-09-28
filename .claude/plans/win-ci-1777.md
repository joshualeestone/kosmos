# win-ci-1777: run the Windows tests on Windows (#1777)

## Finished means
Every PR and every push to main runs the engine's Windows test files on a real Windows runner
(windows-latest, node 26). The job is red on any failure that is not listed with its card, and red
when a listed file passes again or is no longer run.

## What is still true on main (measured 2026-09-27 at origin/main b5c8415; branch now rebased on 3aa29fe)
- Items 1 and 2 of #1777 (name the surface, compose source pins): done
  (windows-coupling-audit-1732, win32-separator-guard).
- Item 3 (the bare `| O_NOFOLLOW` in instructions.js): done (#3950).
- Item 4, the Linux false red: not live in kosmos. `test` runs on macos-latest, and the ubuntu
  jobs only file red-night cards. In claude-setup's ubuntu lint-skills, none of the last 30 runs
  failed on dialect.
- The Windows false green: still true. 73 engine test files have win32 in their name, and nothing
  ran any of them on Windows.

## Measured on windows-latest (probe runs 36354845848 to 36356612430)
- `fs.constants.O_NOFOLLOW` is undefined, and `path.delimiter` is `;`.
- The #1777 decision comment counted the 50 `engine/win32*` files; the probes widened that to
  every `engine/*win32*` file (73), which catches win32-only tests such as runners.win32-codex.
  76 files (the 73, plus platform, store, windows-coupling-audit-1732): 73 pass, 3 fail, about
  11 minutes (the current run time is stated once, in windows.yml). The slowest file is
  win32apply, at 413s to 481s; it hung under the
  first probe, which left stdin open.
- The reds:
  - projects.win32-reveal and trust.win32-key-2281 compare a path with its 8.3 short name
    (RUNNER~1). The reveal's safety behaviour holds; check #2281's key spelling. Filed as #4257
    and fixed by #4265 (test assumptions), so no longer listed.
  - win32handoff's zone-by-interface-name arm: Windows zones are numeric. Filed as #4258.

## Build
- tools/windows-tests.js selects:
  - `*win32*.test.js` in engine/ and at the root;
  - the root's `tools.win-*` / `tools.windows-*`;
  - ALSO (engine) and ALSO_ROOT, which include every test file that branches on a win32 HOST.
  HOST_BRANCH_EXCLUDED names the host-branch files left out, each with why, and a Mac-side test
  fails on any host-branch file that is neither selected nor excluded. 99 files.
- How it runs each file: stdin closed, a 60s per-test timeout, a 20m per-file timeout, and no
  file started after 33 minutes (the rest are NOT RUN, a red). It prints every failing name,
  per-file test and skip counts, and flags a file over half its cap.
- How it judges:
  - KNOWN_RED maps a file to its card AND the exact tests expected to fail. Any other failing
    test, a kill, a spawn error, or a failure with no test named is a new red.
  - A listed test that passes is stale. Stale fails main always, and a PR only when the PR
    touches that file or the script (staleBlocks, via WINDOWS_TESTS_PR_BASE).
  - A file whose every test skips is red unless ALL_SKIP_OK names it.
  - Zero files selected is a failure.
- .github/workflows/windows.yml:
  - windows-latest, node 26; LF checkout; fetch-depth 0; timeout 60m, above the 33m budget plus
    one 20m file.
  - Push to main and pull_request, with the same concurrency shape as test.yml (#4021: never
    cancel a main run).
- engine/windows-tests-1777.test.js covers:
  - selection (synthetic, real tree, and the host-branch guard);
  - failing-name parsing;
  - every verdict path;
  - staleBlocks;
  - that KNOWN_RED and ALL_SKIP_OK name real selected files, cards and tests;
  - the workflow's triggers, env and timeouts.
- ci.main-runs-finish-4021.test.js: windows.yml added to PINNED_WORKFLOWS (its control demanded
  it).
- Test fixes, each measured red on the runner and green after:
  - engine/runners.win-runnable-2270 (a 0o644 POSIX control, POSIX host only);
  - engine.boardauth-1946 (the mode arm asks ownerOnlyModeIsEnforced()).

## Proven on the runner before the PR (temporary push trigger, since reverted)
- Run 36356771856 at 4c12c93: success; 73 passed, 3 failed, all 3 known red; 0 new, 0 stale.
- CONTROL, run 36357499968 at e773de8 (win32handoff taken off KNOWN_RED): failure, "NEW RED
  engine/win32handoff.test.js". So the job can go red on a new failure, not only report one.

- After review round 1 widened the selection to 83 files, run 36358251486 found two more
  harness reds: web.win32-board-copy (a CRLF checkout breaks its '\n}\n' source cut; the job
  now checks out LF, as the shipped bundle is) and the #2270 POSIX controls (no exec bit on a
  Windows host; now POSIX-host only). Run 36358953385 at 4171134: success, 80 passed, 3 known
  red, 0 new, 0 stale. win32apply took 413s.

- Review round 3 found the root's tools.win-* / tools.windows-* tests (the `kosmos` command a
  Windows agent runs, the native installer and launcher, the shims) unselected and unexcused.
  Run 36361538285 selected them (94 files): 8 of the 11 pass; three fail and are filed:
  #4266 (8 native-installer probes; lead: the 8.3 %TEMP% of #4257, possibly a product bug for
  long user names) and #4267 (the open-board opener seam's spawn EFTYPE, and PowerShell's
  kosmos.ps1 resolution). tools.build-windows / tools.publish-windows stay out: Mac-side
  release tooling.

- Review round 4: host-branch files. Run 36363427109 added six. outbox, world-guard-lift and
  cli.world-outbox pass. boardauth's mode arm was fixed. remove's #169 arm is filed as #4269.
  create.test.js failed 121 of 189 (run 36364391579): they need Claude Code installed or macOS
  LaunchAgents, so it is excluded with that reason. Its Windows path is the create.win32-* files,
  which pass. The four e2e/integration files skip everything on the runner and are named in
  ALL_SKIP_OK.
- The same run failed a win32handoff arm that had passed five times: it probes the runner's own
  address (10.1.0.10) and got "refused" instead of a timeout. It is listed in FLAKY under #4258;
  a flaky failure is not judged, and a kill is never excused.

- Rebased onto origin/main after #4265 (#4257) and #4268 (#4267) landed. Both fixed their tests,
  so the four entries under those cards were dropped from KNOWN_RED.
- Rebased again after #4272 fixed #4258's zone arm, whose entry was dropped. win32handoff's
  runner-address arm stays in FLAKY; its test is unchanged on main.
- Still listed at 3aa29fe: #4266 (8 native-installer probes) and #4269 (remove's #169 arm).
  **#4274 (open, #4269's fix)** also asks for create.test.js to move from HOST_BRANCH_EXCLUDED
  into ALSO. Whichever of it and this PR lands second drops the remove entry and moves
  create.test.js, measured on the runner.
- The runner run for the branch as it stands is cited in the PR body (it is taken after the
  last change, so it cannot be written here first).

## Decided
- CI on a GitHub Windows runner, free on this public repo, over the options below.
- Rejected: the whole suite on Windows (always red on POSIX-mode tests, and so walked past);
  more source pins (they catch only the shapes someone thought of, and none of the reds is one);
  waiting for a Windows box; item 4 (not live in kosmos).
- Advisory, like `test`: no branch protection.

## Weakest part
- windows-latest is Windows Server, run as an admin, with no Kosmos user setup. A green there is
  evidence about Windows, not about a user's Windows 11 laptop.
- The job's verdict is only as good as the list. Listing by test name means a known red no longer
  hides other failures in its file, but it does hide a CHANGE inside a listed test (it fails for a
  new reason) until its card is fixed.
- Failing tests are matched by title, so two tests with one title in a listed file cannot be told
  apart; a new failure in the unlisted twin would be hidden.
- A FLAKY test is not run in any sense that counts; the list must stay short.
- The host-branch guard sees two ways a test says "this host is Windows": a process.platform
  comparison with 'win32', and O_NOFOLLOW compared with undefined. A test that infers Windows
  another way (a hardcoded POSIX path, path.sep) is not flagged, and may quietly never run here.
- A file that skips SOME tests on Windows is counted, not judged. A new `skip` on win32 inside
  a file that still runs other tests goes unnoticed.
- On a per-file timeout, only the `node --test` process is killed; its child can outlive it on
  Windows and share the runner with the next files.
- Minutes: the run time is in windows.yml's comment. If the runner turns out flaky (the same sha red, then green), the job
  gets walked past like any always-red check. The timeouts are there to tell a hang from a slow run.

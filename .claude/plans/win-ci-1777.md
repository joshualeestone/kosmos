# win-ci-1777: run the Windows tests on Windows (#1777)

## Finished means
Every PR and every push to main runs the engine's Windows test files on a real Windows runner
(windows-latest, node 26). The job is red on any failure that is not listed with its card, and red
when a listed file passes again or is no longer run.

## What is still true on main (measured 2026-09-27, origin/main b5c8415)
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
- 76 selected files (the 73, plus platform, store, windows-coupling-audit-1732): 73 pass, 3 fail,
  and the suite takes about 11 minutes. The slowest file is win32apply at 431s; it hung under the
  first probe, which left stdin open.
- The reds:
  - projects.win32-reveal and trust.win32-key-2281 compare a path with its 8.3 short name
    (RUNNER~1). The reveal's safety behaviour holds; check #2281's key spelling. Filed as #4257.
  - win32handoff's zone-by-interface-name arm: Windows zones are numeric. Filed as #4258.

## Build
- tools/windows-tests.js: selects `engine/*win32*.test.js` plus ALSO, and runs each with stdin
  closed, a 60s per-test timeout and a 15m per-file timeout. It judges against KNOWN_RED
  (file -> card). Pure selectFiles/judge are exported. Zero files selected is a failure.
- .github/workflows/windows.yml: windows-latest, node 26. Push to main and pull_request, with the
  same concurrency shape as test.yml (#4021: never cancel a main run).
- engine/windows-tests-1777.test.js: selection (synthetic and real tree), the verdict (new red,
  known, stale, missing), that KNOWN_RED names selected files and cards, and that the workflow
  runs the script on windows-latest.
- ci.main-runs-finish-4021.test.js: windows.yml added to PINNED_WORKFLOWS (its control demanded it).

## Proven on the runner before the PR (temporary push trigger, since reverted)
- Run 36356771856 at 4c12c93: success; 73 passed, 3 failed, all 3 known red; 0 new, 0 stale.
- CONTROL, run 36357499968 at e773de8 (win32handoff taken off KNOWN_RED): failure, "NEW RED
  engine/win32handoff.test.js". So the job can go red on a new failure, not only report one.

## Decided
- CI on a GitHub Windows runner, free on this public repo, over the options below.
- Rejected: the whole suite on Windows (always red on POSIX-mode tests, and so walked past);
  more source pins (they catch only the shapes someone thought of, and none of the reds is one);
  waiting for a Windows box; item 4 (not live in kosmos).
- Advisory, like `test`: no branch protection.

## Weakest part
- windows-latest is Windows Server, run as an admin, with no Kosmos user setup. A green there is
  evidence about Windows, not about a user's Windows 11 laptop.
- The job's verdict is only as good as the list. A known red hides new failures inside the same
  file until its card is fixed.
- About 11 minutes a run. If the runner turns out flaky (the same sha red, then green), the job
  gets walked past like any always-red check. The timeouts are there to tell a hang from a slow run.

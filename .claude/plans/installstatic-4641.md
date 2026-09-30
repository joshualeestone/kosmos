# installstatic-4641: test-install.sh's repo-only checks run on every PR (kosmos#4641)

The 0.7.11 staging cut failed at release.sh step 4b on a stale grep of install/setup.sh in tools/test-install.sh
(#4466 had changed the line). test-install.sh runs only at the cut, so no PR, local run or CI saw it.

## Finished means
The test-install.sh checks that only read files in this repo run in CI's shell suite on every PR; the cut still
runs the ones it ran before (the port, update and board-off groups, which sit before test-install.sh's release-gate
exit; the open-default check sits after it, so only a full run ever ran it, and still does); and a break of one of
them goes red in the shell suite (a control proves it).

## Change
- `tools/lib/install-static-checks.sh` (new, sourced): the 23 checks, found by reading every `chk` in
  test-install.sh and keeping those whose expression uses no variable but `SETUP` and `HERE` once escaped `\$`
  pattern text is set aside, plus the helpers they call (`_kosmos_expected_port`, `_kosmos_formula_from`,
  `_postinstall_port_block`, `_postinstall_page_port`), moved verbatim with their comments (the port comment's
  "above" and "this file" reworded for where it now sits). Four groups:
  port derivation (14), the update-on-a-connect-computer greps (3), the board-off greps (5), the open default (1),
  and `install_static_all`.
- `tools/test-install.sh`: sources the lib right after `chk`, and calls each group where its checks sat, so the
  cut runs them as before (the selftest block above them still uses `_kosmos_expected_port` from the lib).
- `tools/test-install-static.sh` (new): defines the same `chk`, runs `install_static_all`, fails on any FAIL, on a
  count other than 23 (so a group that loses a check does not pass quietly), and unless tools/test-install.sh calls
  each of the four groups exactly once, with the three cut groups before its release-gate exit (so the cut keeps
  running them).
- `tools/test-install-static-control-4641.sh` (new): the runner passes on setup.sh; fails, on the exact check, on a
  copy whose launchd restart no longer reads the choice first (a regression, where 0.7.11's was a check made stale
  by a correct change: either way a setup.sh change now meets the check on the PR); fails the count on a lib
  with one check removed; fails the group-call guard on a test-install.sh with one group call removed; and fails it
  on one whose port group is called after the release-gate exit.
- `package.json` `test:shell`: `bash -n` the lib, then the runner, then the control, beside `bash -n tools/test-install.sh`.

## Rejected
- Tagging checks inside test-install.sh and extracting them by pattern at run time: the extraction would be a
  second parser of shell, and the checks' helpers would have to come along by pattern too.
- Moving the greps out of their place in the install story: the groups are called where the checks were, so the
  cut's log reads as before (one reorder: the login-item grep now runs before the "no step heading" check beside it).
- A test-install.sh flag that skips the sandbox: the script refuses to start without dist/ and binds a port first.

## Measured
- Runner: 23/23 pass. The count guard caught my own miscount (I first wrote 24).
- Control: the first break I planted (`_kosmos_board_decide` renamed to `..._GONE`) still passed, because the grep
  matches a substring; the break now renames it to a word that does not contain it, and the control passes both arms.
- Shell-wiring guards (tools.every-test-runs, tools.shell-shard-4317, tools.all-node-tests-considered-1934): 18/18.

## Weakest premise
The group-call guard counts calls at column 0 and places them against the release-gate exit; a call made dead
some other way (after another `exit`, inside a branch the cut never takes) would still count. It fails safe on an
indented or renamed call.

The classifier is a text rule, not a proof: a check whose expression reads a repo file through a variable other
than SETUP or HERE would be missed and stay cut-only. The static set only grows by someone moving a check into the
lib; the count guard makes that a deliberate edit, not a silent one.

## Review iteration 1 (fresh loop, 2026-09-29 22:24)
- The runner now counts checks per group (port 14, update 3, board off 5, open 1), so a check moved from a cut group into the open group, which keeps the total, fails its group's count.
- The runner requires test-install.sh to load the lib exactly once at the start of a line, before its first group call.
- Control arms added for both: a check moved from port to open fails "group port: 13 checks ran, expected 14"; the load moved after the port call fails on the load position; the load removed fails on the missing load.

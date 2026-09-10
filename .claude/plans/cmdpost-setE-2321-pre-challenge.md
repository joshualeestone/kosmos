---
method: challenge-loop
branch: cmdpost-setE-2321
diff_hash: 2e8d21d22da7aef2afd0dbc9dd6aade8904f48d96e3995594f641b2622a1993f
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (round 2 verified the round-1 blocker fixed and the whole class
closed in install/kosmos, with no new defect).
**Method:** fresh blind CTO-lens reviewers, each spawned without the authoring
agent's context.

cmdpost-setE-2321 fixes a `set -e` silent-abort class in install/kosmos. Under the
shebang's /bin/bash 3.2 and `set -euo pipefail`, a failing command substitution in a
BARE assignment (`x=$(...); rc=$?`) aborts the whole process AT the assignment, so
the `rc` check never runs. #2321 was filed for the cmd_post instance (found while
building #2255, where I introduced then fixed the identical bug in cmd_react).

### Round 1 (blind)

- **[correctness] The cmd_post fix is correct.** The reviewer reproduced all arms on
  /bin/bash 3.2: the bare form aborts before the rc check; `rc=0; body=$(...) || rc=$?`
  reaches it (rc captured on failure, 0 on success). The guard test drives a REAL curl
  failure (a stub that destroys the socket after healthy() passes) and the reviewer
  independently confirmed it reds against the unfixed code (empty stdout).
- **[correctness] Scope claim verified TRUE:** cmd_msg/cmd_reply/cmd_whoami/cmd_report
  all use the safe `body=$(...) || { ... }` form; cmd_react already carries the fix.
- **[correctness][BLOCKER] cmd_agents had the SAME bug.** install/kosmos:523 read
  `_ls="$(tmux list-sessions 2>&1)"; _rc=$?` -- the bare pattern. `list-sessions` exits
  non-zero exactly when there is no server, which is the case the #728 "None"/"Could
  not see" branches exist to narrate, so on a machine with no agents `kosmos agents`
  aborted mid-function (printed its header, then died) at the exact moment a person is
  trying to find their agents. FIXED (commit 8b35d3f6): `local _ls _rc=0; _ls="$(...)"
  || _rc=$?`. New test drives a fake tmux through all three arms (no server -> None +
  exit 1; unreadable server -> Could not see + exit 2; a live list -> sessions +
  exit 0), keyed on the ANSWER line the abort kills, not the header it leaves.

### Round 2 (convergence) -- CONVERGED

- **[correctness] The cmd_agents fix is correct**, reproduced on /bin/bash 3.2 (unfixed
  prints only the header then aborts; fixed prints the header AND the answer). Success
  path unchanged. `local _ls _rc=0` is a strict improvement (they were global before;
  nothing outside cmd_agents reads them) and bash-3.2-portable.
- **[test-coverage] The test is a real guard**, keyed on the answer lines (not the
  header, which prints in both bug and fix), verified to red on unfixed code.
- **[correctness] Exhaustive class sweep -- CLOSED.** Every rc/_rc capture site in
  install/kosmos is now safe: kosmos_curl (345) `if/else`; cmd_agents (530), cmd_post
  (780), cmd_react (1032) `|| rc=$?`; cmd_msg/reply/whoami/report `|| { ... }`;
  board_token `|| true`. No remaining bare `x=$(...); rc=$?` under set -euo pipefail.
  Independently confirmed by the author's own grep (only comment lines match the bad
  shape). The class is fixed in this file, not just the filed instance.
- No new defect from either fix.

Converged at 2 iterations: round 1's sole blocker is fixed and round 2 verified the
whole class closed with no new defect.

### Validation

- [correctness] Full node suite GREEN on the final commit (canonical tools/run-tests.sh,
  exit 0).
- [test-coverage] cli.post-setE-2321.test.js: a real curl failure (socket destroyed
  after healthy) is REPORTED with a non-zero exit, not a silent abort. Negative control:
  the unfixed cmd_post gave empty output + exit 52.
- [test-coverage] cli.agents-setE-2321.test.js: a failing list-sessions is narrated as
  None / Could not see per branch, not aborted. Negative control: the unfixed cmd_agents
  printed the header but no answer line (/None/ absent on origin).
- No web/ file in the diff, so no browser-check is required.

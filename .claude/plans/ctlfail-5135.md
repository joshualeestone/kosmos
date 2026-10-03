# ctlfail-5135: a passing control arm prints its planted FAIL as "CONTROL (expected):"

Card: kosmos#5135. Branch: ctlfail-5135.

## Done looks like
- In the cut log, a mobile-shots leak or cover control arm that PASSES shows its child's planted
  `FAIL  ` lines as `CONTROL (expected): `.
- An arm that does NOT pass prints its output untouched, so a real red and the REASONS grep
  (`grep -E '^\s*(FAIL|...)'` on the captured output) are unchanged.
- The harness's own verdict lines (`PASS mobile-shots-*`, `FAIL  leak control ...`, `FAIL  control ...`) are unchanged.

## Steps
- [x] tools/browser-checks.sh: in both arm loops, move the `printf "%s\n" "$out"` after the case match;
      relabel with sed only in the passing branch.
- [x] tools.control-arms-expected-5135.test.js: lift each arm's real bash -c body, run it with a stand-in node,
      four cases (pass relabels, fail stays raw, for leak and cover). Control: the relabel cases red on origin/main's script.
- [x] Real browser run on Agent1s (cut running on Mortals): the four arms, KOSMOS_BC_CI_ALLOWLIST, HEADED=0, head 88996c975:
      all four PASS, four CONTROL (expected) lines, zero `^FAIL` lines, "all page checks passed".

## Sweep
Only these two `_CONTROL` loops exist in tools/browser-checks.sh (grep `_CONTROL`).

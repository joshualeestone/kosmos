# freezetest-0764 (kosmos): test-pointer-freeze.sh passes inside a real cut

The 0.7.64 staging cut (frozen 47dae404c5, 10-22 22:12) went red at step 3 on one shell test:
`tools/test-pointer-freeze.sh` "release.sh made no cut-only home under ... (TMPDIR not passed, or the arm now stops
before it)". Node: 23420 tests, 0 fail. The test is new today (#6620, PR #6802) and had never run inside a cut.

## Why
Its release arm runs a sandboxed release.sh. Inside a real cut (release.sh step 3 runs this file), that sandboxed
release.sh meets its own live-cut guard (`kosmos_refuse_if_cut_live "a second cut"`, release.sh ~450), which sees the
cut running it, and stops before it makes its cut-only home (~576). The home check then reds the cut.

## Decided
- Pass `KOSMOS_HARNESS_IGNORE_CUT=1` to that one sandboxed release.sh, the existing seam that skips the second-cut
  guard. The freeze refusal the arm tests (`pointer_freeze_refuse`, ~444) runs BEFORE that guard, so the arm still
  tests what it names. Rejected: skipping the home check during a cut (it would hide a real TMPDIR leak there).

## Measured
- Beside a stand-in `bash tools/release.sh` process (what kosmos_running_lines matches): main's test reds with the
  cut's exact line; the fixed test passes. With no cut running, the fixed test: ALL PASS.

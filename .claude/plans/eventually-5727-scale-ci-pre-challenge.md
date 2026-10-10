---
method: challenge-loop
branch: eventually-5727-scale-ci
diff_hash: 67a05cc5d6b3bada6743af549e4dc60da0494bbdf5374f4488a57bc7cb371e11
validation: passed
subdir_audit: passed
iterations: 3
converged: true
---

# Pre-challenge proof: eventually-5727-scale-ci (#5727 follow-up 2)

A CI-run test that `tools/run-tests.sh` really EXPORTS a clamped `KOSMOS_TEST_TIME_SCALE` to the
test processes it spawns and PRINTS the clamped scale on a red (Sonya's "runner wiring untested
in CI" note on #5738). Plus Liu's one-line exclusion marker above `engine/connect.test.js`'s
`until`.

## Validation

`tools/test-runner-scale-export-5727.sh` was run on the committed HEAD b097f2f7 (the amended tree
is at this HEAD) under all three environments, each ALL PASS:
- plain: ALL PASS.
- `KOSMOS_TEST_PART=shell KOSMOS_SHELL_SHARD=2/2` (the CI shell-shard job's env): ALL PASS.
- `KOSMOS_TEST_TIME_SCALE=9.99` pre-exported (simulating the outer runner on CI / `yarn test`):
  ALL PASS.
The test drives the REAL runner via `run-tests.sh --only` with `KOSMOS_FAKE_LOAD` forced, so a
saturating load pins the scale to 4.00 and a near-idle load to 1.00 deterministically. It is
wired into `test:shell` (a `bash -n` syntax check + a run), so CI runs it by name; the two-shard
union is still exact (`tools.shell-shard-4317.test.js` passes). A full local suite was not re-run:
the diff is one new shell test + a comment-only line block in `connect.test.js` (node --check
clean), no product or runner code.

counts: no counts-before/after here (this adds a test and a comment; it migrates nothing).

SUBDIR AUDIT: passed (no CLAUDE.md under tools/ or engine/; the new test sits beside its siblings
under tools/).

The diff_hash above is computed as the pre-challenge-gate hook recomputes it:
`git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.

## Challenge-loop ledger (3 blind passes, two models)

Two of the three passes found a real CI-only false-pass that local runs masked. This is the loop
and the model rotation earning their keep: a test whose entire purpose is to catch a wiring
regression would itself have failed to catch it in CI.

### Iteration 1 (Sonnet, blind)
[BLOCKER], FIXED. The CI shell-shard job sets `KOSMOS_TEST_PART=shell KOSMOS_SHELL_SHARD=<n>`, and
`run-tests.sh` refuses `--only` (exit 2) when either is set, so the nested run never reached the
runner; 5 of 6 assertions failed and the red-path `rc != 0` passed vacuously on the exit-2
refusal. It passed locally only because those vars are unset there. FIX: `run_only` resets
`KOSMOS_TEST_PART=all KOSMOS_SHELL_SHARD=` (as `tools/test-cut-guard.sh` does when it nests the
runner), plus a `reached_runner` guard (asserts the runner's `--only: 1 named file(s)` acceptance
line) and the red-path exit pinned to exactly 1 (a test red; a refusal is 2), so no refusal can
pass vacuously. Verified by running with the shard vars set.

### Iteration 2 (Opus, blind, on the iter-1 fix)
[BLOCKER], FIXED. The deeper one Sonnet missed: in CI this test runs INSIDE the outer
`run-tests.sh`, which has already EXPORTED `KOSMOS_TEST_TIME_SCALE`. Bash keeps the export
attribute across a plain reassignment, so the inner runner reassigning it stayed exported EVEN IF
the runner's own `export` keyword (line ~302) were deleted -- the child saw 4.00 and the EXPORT
proof (the test's central claim) passed green. Proven by pre-exporting the var before the test.
FIX: `run_only` now `unset`s `KOSMOS_TEST_TIME_SCALE` inside a subshell before invoking the
runner (a `VAR=val ... bash` prefix cannot unset), so only the runner's own `export` reaches the
child; a dropped export yields `undefined` and reds the pass arm. Mechanism proven both ways
(unset + no export -> child undefined; unset + export -> 4.00).
- [WARNING] `reached_runner` is printed before the claim/harness/light-side refusals, so it is
  necessary-not-sufficient. RESOLVED by a comment making that explicit; the companion rc/seen/
  banner checks catch a post-line-120 refusal.
- [WARNING] the three nested runs run the leak guards, a rare false-FAIL vector on the
  self-hosted CI Mac under live fleet activity. DEFERRED/ACCEPTED (documented in the plan's
  weakest-part): it is a false-FAIL only (never a false-pass), mitigated by the #5092 live-root
  skip, and inherent to an end-to-end test over a stub.
- [NIT] SIGPIPE-under-pipefail on the greps: not practical (~1.6 KB output << pipe buffer). No change.

### Iteration 3 (Opus, blind, on the iter-2 fix)
No [BLOCKER], no [WARNING], no [CONVENTION]. The reviewer PROVED the fixes by experiment, not
inspection: it copied `run-tests.sh` to a scratch tree with the `export` keyword deleted and
confirmed the test false-passes WITHOUT the `unset` and REDS with it; and that deleting the
export reds the pass arms while the banner (print) arm still holds. It confirmed the `rc==1` pin,
the banner CONTROL, determinism, the shard-union, no leakage, and the comment-only
`connect.test.js` change. Two [NIT]s, both loud-false-FAIL-only (never false-pass), no change:
the SIGPIPE non-issue again, and `reached_runner` coupling to the line-120 wording.

## Convergence
Three blind passes across two models (Sonnet, Opus, Opus). Each of the first two found a distinct
CI-only false-pass that local runs hid; both fixed. The third, by the model that found the subtle
export blocker, proved both fixes catch their target regression and found zero actionable issues.
The remaining NITs are non-blocking and the one deferred WARNING is an accepted end-to-end
residual. Converged.

## Origin classification
Every change is BRANCH-origin: the new `tools/test-runner-scale-export-5727.sh`, its package.json
wire, the comment block above `connect.test.js`'s `until`, and the plan. No other file is touched.

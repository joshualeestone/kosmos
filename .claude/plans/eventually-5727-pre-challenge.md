---
method: challenge-loop
branch: eventually-5727
diff_hash: 2ba1ea50a42bb7232020cae160be23bfef2e04da7ec07015eab75c660776ce01
validation: passed
subdir_audit: passed
iterations: 2
converged: true
---

# Pre-challenge proof: eventually-5727

PR-1 of the #5727 class fix: a shared load-aware `eventually()` poll helper plus
`KOSMOS_TEST_TIME_SCALE` (set once by the runner from the box's load-per-core), and the
two red (c)-poll tests migrated onto it. Scope per Liu (m4867): helper + scale + only the
red poll copies; the other ~86 copies follow in per-directory batches, and #5723 and the
assert-on-work-done rewrites stay with Mona.

## Validation

`unset KOSMOS_AGENT_TOKEN && bash tools/run-tests.sh` (the repo's canonical full suite:
node files + the shell chain, which now includes tools/test-time-scale-5727.sh) on the
committed HEAD 8cbd56876, on Mortals (12 cores, load ~1.7, so KOSMOS_TEST_TIME_SCALE
computed to 1.00 -- every migrated budget byte-identical to pre-change). The real terminal
tally is recorded below, read from the run's own output, not from a wrapper exit code.

VALIDATION LINE: GREEN. node: 18013 tests, 17770 pass, 0 fail, 0 cancelled, 243
skipped, 0 todo (duration ~346s). Shell chain: every script ALL PASS / 0 failures
(test-time-scale-5727 ALL PASS; the two migrated OpenAI files pass; the unset-var
scale-pin test ran green). EXIT=0, read from the run's own output, with both VALIDATE
START and VALIDATE END banners present so the run completed (not cut mid-flight; a
killed suite would show a nonzero cancelled count and no END banner). HEAD 8cbd56876,
Mortals (12 cores), KOSMOS_TEST_TIME_SCALE computed to 1.00, so every migrated budget
was byte-identical to pre-change. The scale/load line is a red-side diagnostic (#708:
the runner prints the machine banner only beside a nonzero exit), so this green run
correctly did not print it; the wiring that puts "wall-clock test time-scale Nx" into
that banner was verified by the shell test and by reading run-tests.sh lines 283/621.
SUBDIR AUDIT: passed (audit_subdir_claudemd_changed_paths rc=0; no CLAUDE.md under engine/,
tools/, tools/lib/, or test-support/, so no subdir convention file needed updating).

The diff_hash above is computed exactly as the pre-challenge-gate hook recomputes it:
`git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.

## Challenge-loop ledger (2 blind passes, two models)

Every pass independently verified the load-bearing properties: `eventually()` preserves the
replaced loops' semantics (first probe + predicate BEFORE any deadline check, strict
`> budget`, 20ms default step, sync or async probe, returns the probed value, throws on
timeout); `SCALE` is floored at 1 so no budget can shrink; the shell scale clamps to
[1.00, 4.00] with the knee at half-subscription and a fail-safe to 1 on garbage/empty load;
the runner computes the scale exactly once and shows it in the banner; the two migrations
keep their call sites and route the old last-state detail through `describe`.

### Iteration 1 (Sonnet, blind)
No [BLOCKER], [WARNING], or [CONVENTION]. All four named test commands ran green (node 7/7,
shell scale 15/15, the two migrated files 24/24).
- [NIT] a pre-set garbage `KOSMOS_TEST_TIME_SCALE` would print "abcx" in the banner while the
  helper floored it to 1. FIXED: the runner now ALWAYS computes the scale (never taken
  pre-set); the reproduce-a-flake knob is `KOSMOS_FAKE_LOAD`, which feeds the same clamped
  math, so a forced value cannot bypass the guardrails or print garbage.
- [NIT] errexit note on the `cores` fallback: confirmed safe (not the function's last statement).
- [NIT] no test covers the runner wiring: a documented coverage gap. The logic lives in the
  tested lib; a text-matching runner test would assert text, not behaviour, so it was not added.
- [STRENGTH] floor-at-1 in both the JS and the shell; the non-satisfiable-predicate test design
  keeps this test out of the flaky class it guards.

### Iteration 2 (Opus, blind, on the post-fix code)
No [BLOCKER], [WARNING], or [CONVENTION]. All six test commands green; the em-dash scan was
clean with a positive control confirming the scanner fires. Verified the iter-1 fix and every
adversarial checklist point against the actual runner (discovery, #1934 coverage balance,
shell-shard wiring, frozen-roots).
- [NIT] the plan file still said the runner "respects a pre-set value" (stale after the iter-1
  fix). FIXED: plan updated to "computed, never taken pre-set".
- [NIT] `timeoutMs: 0` with a first-probe-false predicate may sleep one step before timing out;
  harmless, matches the old loop exactly, and the only `timeoutMs: 0` call site returns on
  probe 1. No change.
- [STRENGTH] defense-in-depth floor (JS + shell); always-compute removes the seam hazard;
  deterministic tests that turn on call count, not wall time.

## Convergence
Two models (Sonnet, then Opus), zero [BLOCKER]/[WARNING]/[CONVENTION] in either pass. The only
code fix (iter 1, the pre-set seam) was re-reviewed clean by a DIFFERENT model in iter 2; the
iter-2 fix was plan-doc only and cannot regress product code. Converged.

## Origin classification
Every change is BRANCH-origin, introduced by this branch: the helper, the scale lib, the runner
wiring + banner line, the two migrations, the two tests, the package.json wire, and the plan. No
SELF prose beyond the comment and plan corrections the loop itself drove.

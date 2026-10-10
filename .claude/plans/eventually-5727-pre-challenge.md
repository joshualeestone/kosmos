---
method: challenge-loop
branch: eventually-5727
diff_hash: 9a7424c9deb9d5680dba399ee6ead4dc79598c639873bc206d33d1eb2f25e2f0
validation: passed
subdir_audit: passed
iterations: 3
converged: true
---

# Pre-challenge proof: eventually-5727

PR-1 of the #5727 class fix: a shared load-aware `eventually()` poll helper plus
`KOSMOS_TEST_TIME_SCALE` (set once by the runner from the box's load-per-core), and the
two red (c)-poll tests migrated onto it. Scope per Liu (m4867): helper + scale + only the
red poll copies; the other ~86 copies follow in per-directory batches, and #5723 and the
assert-on-work-done rewrites stay with Mona. Iteration 3 added, after review (m4872/m4878),
a cap on the JS scale and a guard that the JS and shell bounds agree.

## Validation

Full canonical suite (`unset KOSMOS_AGENT_TOKEN && bash tools/run-tests.sh`: node files +
the shell chain) was run GREEN at the prior HEAD 8cbd56876 on Mortals (12 cores, load
~1.7, so KOSMOS_TEST_TIME_SCALE computed to 1.00 and every migrated budget was
byte-identical to pre-change):

VALIDATION LINE: GREEN at 8cbd56876. node: 18013 tests, 17770 pass, 0 fail, 0 cancelled,
243 skipped, 0 todo. Shell chain: every script ALL PASS / 0 failures. EXIT=0, read from
the run's own output, with both VALIDATE START and VALIDATE END banners present so the run
completed (not cut; a killed suite would show a nonzero cancelled count and no END banner).

The iteration-3 changes (HEAD c7c07622) do not alter suite-scale behaviour: the new JS cap
only affects a forced value above 4, which the runner never emits (its shell lib already
caps at 4), and the other changes are test-only (a new cap/mutation-control test, the drift
guard, and larger upper-bound timeouts) plus additive exports. The two migrated engine files
are UNCHANGED since 8cbd56876. The delta was validated directly on c7c07622:
- `node --test eventually-5727.test.js` -> 8 tests, 8 pass, 0 fail (the added cap test green).
- `bash tools/test-time-scale-5727.sh` -> ALL PASS, including the new drift guard (JS
  SCALE_CAP '4' == shell '4.00'; JS SCALE_FLOOR '1' == shell '1.00'), with negative controls
  confirming the guard fails on a drifted value (5 vs 4) and on a missing export ('' vs 4).
- The two migrated files were re-run GREEN on the branch (24/24 in three consecutive runs;
  driver alone 14/14) on a quiet box, confirming the earlier under-load reds were the
  load-driven flake this PR targets, not the migration.
CI re-runs the whole suite on c7c07622 and is the authoritative green-by-name gate for merge.

SUBDIR AUDIT: passed (audit_subdir_claudemd_changed_paths rc=0; no CLAUDE.md under engine/,
tools/, tools/lib/, or test-support/, so no subdir convention file needed updating).

The diff_hash above is computed exactly as the pre-challenge-gate hook recomputes it:
`git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.

## Challenge-loop ledger (3 blind passes, two models)

Every pass independently verified the load-bearing properties: `eventually()` preserves the
replaced loops' semantics (first probe + predicate BEFORE any deadline check, strict
`> budget`, 20ms default step, sync or async probe, returns the probed value, throws on
timeout); `SCALE` is floored at 1 so no budget can shrink; the shell scale clamps to
[1.00, 4.00] with the knee at half-subscription and a fail-safe to 1 on garbage/empty load;
the runner computes the scale exactly once and shows it in the red-side banner; the two
migrations keep their call sites and route the old last-state detail through `describe`.

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

### Iteration 3 (Sonnet, blind, on the cap change requested in review)
Run after Sonya's approval of #5738 and Liu's m4878: clamp the JS scale to the shell lib's
[1, 4] with a 77->4 mutation control and a guard that the two derivations agree. No [BLOCKER],
no [CONVENTION]. Two [WARNING], both resolved:
- [WARNING] the two migrated engine files failed 8 of 24 on a first run under heavy box load
  (load 9-11, all 4-second timeouts). RESOLVED: a background retry on a quiet box passed them
  24/24 in three consecutive runs (driver alone 14/14); main passed 24/24 too. The migrated
  loop is logically identical at scale 1, so those reds were the load-driven flake this PR
  exists to fix, not the diff. This is a clean branch verdict, not a defect.
- [WARNING] the [1, 4] bounds now have two derivations (test-support/eventually.js and
  tools/lib/test-time-scale.sh), so a future cap change in one could drift from the other.
  RESOLVED, not deferred: tools/test-time-scale-5727.sh now reads SCALE_CAP / SCALE_FLOOR from
  the JS module and asserts they equal the shell lib's own clamp ends (4.00 at a saturating
  load, 1.00 at zero), so a cap changed in one file but not the other fails the suite. The
  guard is armed, not vacuous: negative controls show it fails on 5-vs-4 and on a missing
  export.
- [NIT] `Infinity` resolves to the floor (1), not the cap, because `Number.isFinite` rejects
  it. Safe (never shorter than the literal) and it is a non-numeric input, so it belongs with
  the floor cases; no change. Acknowledged.
- [NIT] the call-count tests carried a real 1000ms upper-bound budget, so a >1s stall could in
  principle flake them. FIXED: bumped to 30000ms. The predicate returns early, so the budget is
  never reached and the change costs nothing while removing the last wall-clock dependence.
- [NIT] the runner's `. lib 2>/dev/null || true` fails open to scale 1.00 if the lib is
  missing. This is the repo's convention for these libs (matches board-origin / cut-guard) and
  is safe (never shortens a budget); no change. Acknowledged.
- [STRENGTH] clamp correctness verified across every input class (absent, '', '0', '0.3', '-3',
  'abc', '4x', ' ', Infinity -> 1; '  4 ', '4' -> 4; '77', '4.5' -> 4); the cap test is an
  independent-oracle mutation control (literals 4 and 16000, so removing or widening Math.min
  fails it, and '3.9' catches a cap-everything mutation); the migrations are byte-equivalent at
  scale 1 with only the throw text changed and no dependants on the old text.

Iteration-3 changes made AFTER this blind pass were the NIT-2 timeout bump (test-only) and the
WARNING-2 drift guard (a new test assertion plus additive module exports). Neither changes the
clamp logic, so neither can regress the product code the pass reviewed; both were suggested by
the pass itself.

## Convergence
Three blind passes across two models (Sonnet iter 1, Opus iter 2, Sonnet iter 3). Zero
[BLOCKER]/[CONVENTION] in any pass. The iter-1 code fix was re-reviewed clean by a different
model (Opus) in iter 2. Iter 3's two warnings are both resolved by content (W1 is contention,
verified green on a quiet box; W2 is closed by the drift guard, not deferred). The only code
changes after iter 3 are reviewer-suggested and either test-only or additive, so no blocker,
warning, or convention remains outstanding. Converged.

## Origin classification
Every change is BRANCH-origin, introduced by this branch: the helper, the scale lib, the runner
wiring + banner line, the two migrations, the tests, the drift guard, the package.json wire, and
the plan. No SELF prose beyond the comment and plan corrections the loop itself drove.

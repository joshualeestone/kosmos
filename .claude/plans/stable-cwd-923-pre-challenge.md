# Challenge-loop proof: stable-cwd-923

Diff hash (`git diff "main...HEAD" -- ':!.claude/plans/stable-cwd-923-pre-challenge.md' | shasum -a 256`):
`ddcc0f53810e99d28de7c14091d9463b36f07da56497de17970a721ad3b3a672`

## Round 1

Blind reviewer found:
1. (Medium) Plan overclaimed "only `run()`" spawns without an explicit `cwd`; six other sites do too (attachments.js, devicedoor.js x2, remote.js x2, update.js). Same process-wide chdir protects them, but the claim was wrong.
2. (Medium) Verification gap: plan promised a direct reproduction of the reported failure shape, only the indirect cwd-proxy test shipped.
3. (Low) Unverified whether any future relative-path resolution depends on the old (pre-fix) cwd.

Fixed: corrected the plan's causal narrative and spawn-site list; added a second test to `server.startup.test.js` that reproduces the precise OS-level mechanism (a spawned child does not fail to start from a deleted parent cwd -- it fails when the CHILD calls `process.cwd()` at its own startup, exactly what `claude install` does) with a genuine before/after split, verified by hand first via direct `node -e` reproduction before committing the test.

## Round 2

Blind reviewer, reviewing the state fresh (not trusting round 1's fixes were sufficient): zero findings. Independently re-verified the mechanism, the new test's validity (ran it, checked for zombie processes), spot-checked all six spawn-site line numbers, confirmed round 1's diff touched only the plan doc and test file, checked no other in-flight branch touches server.js's startup block, ran the full suite (2144/2144 passing).

## Convergence

Round 2 found zero new BLOCKER/WARNING/CONVENTION findings. Converged.

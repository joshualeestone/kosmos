---
method: challenge-loop
branch: provider-qualifier-2612
diff_hash: 858e4b51faf3e3c323055090b4c9e4f98d523b3acc697c3416c66d9ebf4a2d41
timestamp: 2026-09-10T09:24:54Z
iterations: 12
---

# Challenge-loop proof: provider-qualifier-2612 (kosmos#2612)

Twelve iterations, alternating opus and sonnet, each a fresh blind agent. Converged on
iteration 12 with **zero findings**. Eleven of the twelve found something real.

## Iteration record

| # | model | findings |
|---|---|---|
| 1 | opus | 1 BLOCKER, 5 WARNING, 4 NIT |
| 2 | sonnet | 1 CONVENTION |
| 3 | opus | 4 WARNING, 1 CONVENTION, 1 NIT |
| 4 | sonnet | 1 BLOCKER, 1 CONVENTION, 2 NIT |
| 5 | opus | 1 WARNING, 6 NIT |
| 6 | sonnet | 1 WARNING, 1 NIT |
| 7 | opus | 6 WARNING, 1 CONVENTION, 3 NIT |
| 8 | sonnet | 1 WARNING (uncommitted work in tree; NOT a clean round) |
| 9 | opus | **1 BLOCKER**, 2 WARNING |
| 10 | sonnet | 1 CONVENTION, 1 NIT |
| 11 | opus | 2 WARNING, 1 NIT |
| 12 | sonnet | **none** |

Iteration 8 is not counted as a clean round: it reviewed a tree holding uncommitted work and
correctly flagged exactly that.

## The defects that mattered

**Iteration 9 found the original bug still shipping.** The grouping key was
`name || email || keyTail` while the screen renders
`name || email || keyTail || label || dir`. The key was a strict PREFIX of what each row shows, so
any account identified only by its label keyed to '', was never counted ambiguous, and got no
qualifier: two rows both read "Sign in again as work". Reachability read in the engine rather than
assumed. The key now READS `acctPrimaryName` instead of carrying a stale copy of its chain.

**Case-sensitivity was found FIVE times, each where the previous four fixes had not looked:** the
label branch, the reserved word `main`, the provider id in the group set, the provider id at the
ternary, the grouping key itself, and finally `dir` (collision-proof as a STRING, not as a SOUND).

**Duplicated facts drifted five times:** two provider-id derivations, the key vs `acctPrimaryName`,
the cross-derivation pin's membership list, and three test files each carrying their own copy of the
page-extraction harness.

**Comment defects were the dominant class, eight of them**, and iteration 11's verdict is the
finding worth carrying forward:

> "Ten rounds have not trained a blind spot into the CODE. They have trained one into the PROSE."

## Evidence

- **46 arms** in `web.account-qualifier.test.js`.
- **Full suite `bash tools/run-tests.sh` rc=0: 5604 tests, 5604 pass, 0 fail, 0 skipped**, run after
  merging origin/main.
- **Browser check green under real Playwright**, and still REDS against origin/main's page with the
  two problems its header states, so it has not been disarmed by any edit to it.
- **Mutation battery, 7 single-point mutations, all 7 caught** post-merge, verified with no residue.
  Each mutation asserts its target is present exactly once before substituting, so a mutation that
  fails to apply cannot masquerade as one the tests caught.
- **Collision sweep: 0 audible collisions across 62,208 two-row fixtures** including case-variant
  dirs, with controls at 164 and 1760 proving the sweep can return the dangerous answer.
- **Iteration 11 independently ran 13 mutations (12 red, the 13th documented-unpinnable) and
  2,075,040 brute-forced row-pairs** over a 1,440-row pool against an oracle it proved live.

## Known limits, stated rather than glossed

- **One mutation is unpinnable and is labelled so at the code:** `takenAlready('main')` vs
  `used.has('main')`. Measured genuinely unobservable (0 differences across 110,592 output
  comparisons and 64,000 collision checks); the two `main` guards each cover the other's
  single-revert path. A redundant guard honestly labelled beats a vacuous arm claiming to hold it.
- **`distinctly()` cannot separate two rows sharing a `dir`**, and nothing inside this function
  can: the returned Map is keyed on `dir` and all three callers look it up by `dir`, so the return
  shape cannot express two answers for one dir. Stated at the code.
- **A brute-force sweep proving "no two sound alike" does not prove "every qualifier is useful."**
  Those are different properties, and the #1917 harm class (distinct but meaningless) is invisible
  to the collision oracle. It was hunted specifically in iteration 12 and caught by suite arms.
- **Nobody has used this on a running board.** It is code plus tests; that is a release step.
- **Josh has not seen the words "Claude" / "OpenAI" as qualifiers.** One line to change, and the arms
  pin the values so a change fails loudly rather than drifting.

## Merge state

origin/main merged in at 25 commits ahead / 0 behind. `accountQualifiers` proven **byte-identical
across the merge** (function body extracted from both sides and compared), so the merge cannot have
altered the reviewed behaviour.

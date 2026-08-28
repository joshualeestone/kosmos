---
pre_challenge: true
method: challenge-loop
branch: titlename-1168
diff_hash: 6439b80ef2808ed6463fe6bfd7f7ecfb8c86e2187c0ed44647e4804463adc1ea
subdir_audit: passed
timestamp: 2026-08-28T17:08:47Z
iterations: 7
---

## Challenge-loop results, 7 blind iterations, converged

Each iteration was a fresh agent with no knowledge of prior findings. The ledger below is
the orchestrator's; no reviewer saw it.

**Convergence rule, stated to the PM BEFORE iteration 7 returned:** only comment or coverage
findings and no behaviour defect, converge; if it finds behaviour, keep going, whichever
answer comes back. Iteration 7 returned `BEHAVIOUR DEFECTS: none`. Behaviour has been
unchanged since iteration 4; iterations 5, 6 and 7 changed comments and tests only.

### Ledger

| # | Iter | Category | Where | Finding | Status |
|---|---|---|---|---|---|
| 1 | 1 | BLOCKER | status.js NAME_TRUNCATED | deleted real capitalised roles | FIXED |
| 2 | 2 | BLOCKER | status.js joining list | `Jr\|Sr` reintroduced a fabricated role | FIXED |
| 3 | 2 | WARNING | status.js arms | bold and prose arms disagreed | FIXED |
| 4 | 3 | WARNING | status.js `{0,3}` | bound unnecessary, then `{0,2}` too tight | FIXED |
| 5 | 3 | CONVENTION | status.js NAME_TAIL_ABBREV | dead constant with a false comment | FIXED |
| 6 | 4 | WARNING | identity.test.js | `Mary J. She` fabricated a role | FIXED |
| 7 | 5 | WARNING | identity.test.js | `Ms` survived mutation | FIXED |
| 8 | 5 | WARNING | identity.test.js | long canary saturated, proving nothing | FIXED |
| 9 | 6 | WARNING | status.js:anchor comment | my claim that the anchor stops a fabricated role was FALSE; the comma rule kills that case | FIXED |
| 10 | 6 | WARNING | identity.test.js | `Jr\|Sr` EXCLUSION had no test; adding it back left the suite green | FIXED |
| 11 | 6 | NIT | status.js NAME_ENDS_SENTENCE | quadratic on a 200k token; measured at parity with main, all 5 call sites bound to 4000 chars | DEFERRED, pre-existing and unreachable |
| 12 | 7 | WARNING | status.js NAME_PREFIX_RUN | `[A-Z]` widens to `[A-Z]+` with the FULL suite green | FIXED |
| 13 | 7 | WARNING | (process) | branch 4 behind origin/main, local `main` ref stale and divergent | FIXED by rebase |
| 14 | 7 | NIT | status.js | comment duplicating the block below it; JSDoc at column 0 in a function body | FIXED |
| 15 | 7 | NIT | status.js | doubled blank line | FIXED |
| 16 | 7 | WARNING | create.js, discover.adopt.test.js | several real findings, ALL inherited from commits already on origin/main | DEFERRED to #1359 |

### The pattern worth naming, found twice

Findings 10 and 12 are the same defect one iteration apart: **a rule about what does NOT join,
stated in a comment and pinned by nothing.** Mutation kills what is present; an exclusion has
no line to mutate, so a suite can be provably thorough about the inclusion list and blind to
the constraint beside it. Both are now pinned with both arms.

### Verification

- Full suite on the rebased base: **2780 tests, 2780 pass, 0 fail**, exit 0 read from the
  captured log rather than a harness status.
- Mutation, re-run by me rather than assumed: each of the 8 titles individually; `Jr|Sr` added
  back; `[A-Z]` widened; bounds at {0,1},{0,2},{0,3},{0,5},{0,10}; either half of the
  `(?:(?<!\.)|PREFIX_RUN)` alternation; the `You are ` anchor; `(,)?` to `(,?)`; `roleUnmarked`
  forced false; the bold-arm guard. **All die.**
- Iteration 7 independently reproduced every measured claim in the new comments, including the
  84-file corpus result and the anchor-removal split, and found none that measurement
  contradicts.
- No ReDoS: 4000-char adversarial inputs parse in under 0.1ms, same order as main.

### One behaviour difference that is a decision

`You are Anna the copywriter.` gives role `null` where main gave `copywriter`. The comma rule
is worse than main on a no-comma prose role. It stays: it is the card's declared standard,
pinned with an explicit escape hatch, and on the only real corpus it fires 4 times and is right
all 4. The disagreement, if any, is about the standard and not the implementation.

[STRENGTH] Mutation-resistant where it matters: 14 of 16 rules die under mutation.
[STRENGTH] Every measured claim in the comments reproduced independently by a blind reviewer.

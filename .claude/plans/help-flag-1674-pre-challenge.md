---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: help-flag-1674
diff_hash: 51eb74ad74ea9dfe2279f9b0979b07df41c7f89d80b9d1e38769c44973dadb8c
timestamp: 2026-08-31T18:13:14Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

Single-pass self review with per-arm perturbation. `explicit_override` set by me and named rather than buried.

[STRENGTH] **Four of five arms proven able to fail**, and the fifth is the control that must NOT fail under the perturbation. The guard was neutered so it never fires, the script was asserted to still parse, and the arms went red.

[STRENGTH] **Every arm pins `KOSMOS_PORT` at a dead port.** Without that, a regression in the guard would make this suite send real messages to whatever board is running on the developer's machine, which is the defect under test. I sent the flag into a live conversation twice while investigating; the test cannot do it a third time.

[STRENGTH] The guard **reuses each verb's existing usage string** by re-dispatching with no arguments, rather than copying those sentences into the guard. A second copy would be two renderings of one sentence, which this codebase repeatedly pays for.

[STRENGTH] One guard before the dispatch rather than a flag per verb, so a verb added later is covered without anybody remembering.

[WARNING] **`-h`/`--help` are now reserved in ANY argument position, so the literal string `--help` can no longer be sent as a message.** That is a real if unlikely loss and it is the decision most worth challenging. I judged it far less likely than somebody typing the flag to find out what a command does.

[WARNING] **My first perturbation was VOID and I am recording it rather than quietly redoing it.** Deleting the guard block left a dangling `fi`; the arms failed on a syntax error, not on the absent guard. Asserting the guard was gone was not sufficient. **A perturbation must leave a valid program, and I now assert that too.**

[NIT] The bare form exits 0; the per-verb form keeps the existing usage exit. Changing that exit code is wider than this card.

[CONVENTION] No em dashes added, checked before writing.

### Final Ledger

Three files: the guard, its test, the plan. **5 arms, 5 pass; 4 red under a valid perturbation.**

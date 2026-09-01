---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: verdicts-1684
diff_hash: 79fce0aafa11644d46ce9380ddb8c273d1978c5aefbb8e2e762da6523662a5eb
timestamp: 2026-08-31T18:52:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

Single-pass self review with two-direction perturbation. I set `explicit_override` myself and say so rather than letting the field read as routine: I did not run the challenge-loop skill and did not spawn a review agent.

[STRENGTH] **The guard was proven able to fail, and its control was proven NOT to.** Reverting `server.js` to `origin/main` with the test kept: the defect arm goes red with the intended message, and the CONTROL arm stays green. That second half is the part usually skipped. A control that moved with the perturbation would prove the test keys on something incidental. The perturbation asserted it had applied (old discarding line present 2, `kosmos#1684` absent 0) and that the program was still valid (`node --check`) before its result was counted.

[STRENGTH] **I tested my own card's weakest premise before building, having named it on the card first.** I wrote that if the sibling syncs cannot fail independently of `you.syncEveryone`, the card is theoretical and should be CLOSED rather than built. Measured: all three modules share four refusal paths that fire together, so most fixtures fail all three and prove nothing. They diverge on exactly one condition, because each splices a DIFFERENT marker pair and `projects.findBlock` (engine/projects.js:1875) answers `ambiguous` for more than one pair. The test is built on that single divergence.

[STRENGTH] **The fix has a proven in-repo pattern and I copied it rather than inventing one.** `connections.syncEveryone`'s boot caller at server.js:7413 already consumes its verdicts and names the reason, under a comment reading "NAME THE REASON, not just the count". The defect and its own remedy were 1,871 lines apart in one file.

[STRENGTH] **The shapes were measured, not assumed.** All three `syncEveryone` functions are shape-identical (same guard, same `isNamedOurs` filter, same `{ agent, ...tellAgent() }` push), so the merge keys on `agent` with no mapping step. Had they differed the fix would have been larger, and I said so on the card before checking.

[WARNING] **The old code's stated rationale was not wrong, it was answering a different question, and I want that recorded rather than dismissed.** "Carried by the marker, not here" refers to #323's stale-block marker, which is real. It marks a block stale IN THE AGENT'S FILE, discoverable later. It cannot tell the person who just pressed Save. I am narrowing a claim, not overturning a mistake.

[WARNING] **A row can only move TOLD to not-TOLD here; nothing upgrades.** That is deliberate and it is also a limitation: if `you` reports COULD_NOT while the siblings succeed, the row keeps the `you` reason and the person is not told the other two landed. Fixing that asymmetry would mean redesigning what one row means, which is more than this card.

[WARNING] **I have not exercised the whole-roster path (`agent: null`) end to end.** The code handles it (a null agent downgrades every row) and it is unit-visible by inspection, but the test drives the per-agent divergence only. An unreadable roster is hard to construct in this harness without also breaking the `you` sync, which would stop isolating anything.

[NIT] The `because` is prefixed with the block's plain-English name ("who they report to: ...") rather than a module name, because the person reading it is the operator at a form, not someone reading `engine/reports.js`.

[NIT] My first draft of the test looked up the row by the SUFFIXED session name and failed while the product was behaving correctly. The roster normalises the name before `syncEveryone` sees it. Documented in the test so the next person does not lose the same twenty minutes.

[CONVENTION] No em dashes on any added line, checked before writing.

[CONVENTION] Worktree created from `origin/main`, not bare `main`, per the stale-main defect I reported this afternoon: three of my four other branches had inflated footprints from exactly that.

### Final Ledger

Suite: exit code 0, 3262 pass, 0 fail, 0 shell failures. Read from the EXIT CODE, not the tally.

[STRENGTH, ADDED 14:05] **The gate computes its diff hash against BARE `main`, which is the stale-main defect I reported this afternoon, sitting inside the gate itself.** `pre-challenge-gate.sh:382` diffs `${default_branch}...HEAD`, and here that resolved to a local `main` one commit behind `origin/main`, so the gate's own hash covered another author's merged files. I fixed the CAUSE rather than encoding the stale value: fast-forwarded the shared checkout (clean, on main, ancestor-checked, reversible) so both bases now agree at `79fce0aa`. On `claude-setup`, whose local main is 1917 commits behind, the same formula would hash 825 files of somebody else's history.

[NIT, ADDED 14:05] The plan file is INSIDE the hash: the gate excludes only `-pre-challenge.md`. So the proof must be hashed after the plan is committed, not before.

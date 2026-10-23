---
pre_challenge: true
method: challenge-loop
branch: roomclaim-6946
diff_hash: e48def604ff4970de7af0bf15250954af0acfd853b23ba3279401cf0ebd41ecf
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T02:48:00Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, the cap under Splinter's 10-22 11:08 usage rule.
**Converged:** No, stopped at the cap with **no BLOCKER open**, as the rule allows. Round 8 found 2 WARNINGs and 2 NITs, filed as the follow-up card **#6952** (claimed: icecreamkitty; built on branch claimfix-6952, stacked on this one, PR after this merges).
**Validation:** the Mortals full suite on the final head e36d187d2c: **23419 tests, 0 failed** (334 skipped), with the shell shards green. Validation hash e48def604ff4 is the same diff this proof hashes. Two earlier full runs each failed, and both are fixed:
- 217e00a14b: engine.reachable (an export reached only from tests) and a temp sandbox left behind.
- e36d187d2c: the `--help` exit-0 case pins its verb order, and `claim` had been put mid-list.

### Per-iteration breakdown (details per round are in roomclaim-6946.md)
| Round | Blockers | Warnings | What it found, how it was fixed |
|---|---|---|---|
| 1 | 2 | 6 | A removed agent's claim locked a post for good; skin-toned 🙋 could not be released. Membership filter added, every 🙋 stored as plain. |
| 2 | 0 | 3 | Takeover made silent; a returning member's claim came back. The person's takeover (later removed), and a new claim ends a departed one. |
| 3 | 0 | 2 | The person's only 🙋 is a click on an agent's pill, so the takeover was wrong. The person's 🙋 is an ordinary reaction. |
| 4 | 0 | 3 | The room route's member filter was untested; a release with nothing held hid the holder. Both fixed through the real route. |
| 5 | 0 | 1 | The guidance said release "when you stop" (Stopped means finished too). Reworded. |
| 6 | 0 | 1 | A 🙋 from before this rule would have counted as a claim. Claims are marked `claim: true`. |
| 7 | 0 | 1 | An old unmarked pill could never be taken off. Every take-off removes all 🙋 forms. |
| 8 | 0 | 2 | The cap. Leftovers are #6952. |

Each rule added in review has a mutant that its test catches (recorded per round in the plan).

### Weakest premise
That agents run `kosmos claim` before posting. The rule only binds an agent that claims. The doctrine (v38) and the "is claimed by" line in `kosmos room` are the levers.

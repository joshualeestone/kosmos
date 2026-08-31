---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: deployguard-1669
diff_hash: f325bf332d5c09e5a04b71a9247a4f18d7f5e8d3aac5ff19cb70568dd95ebaf4
timestamp: 2026-08-31T15:50:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

Single-pass review with perturbation testing. I set explicit_override myself and say so
rather than letting the field look routine: I did not run the challenge-loop skill and did
not spawn a review agent, having no standing go-ahead for one on this branch.

[STRENGTH] The four new arms were proven able to fail. Removing the marker write reds three
of them (3 failures) and the CONTROL correctly stays green, because it asserts the marker is
absent from the SOURCE tree, which the write does not affect. The perturbation asserted it
applied (marker references 3 to 0) before the result counted.

[STRENGTH] The control is the load-bearing arm and it was chosen deliberately. Without it, a
stray marker lying in any checkout would satisfy the other three assertions, and the guard
built on the marker would be worthless while looking tested.

[STRENGTH] The pre-existing suite is untouched and still reports 0 failures, so this is
additive rather than a rewrite of anybody's coverage.

[STRENGTH] The design rests on a measurement rather than an assumption: exactly one scripted
production deploy exists in the tree (release.sh:753), against a control of 9 files
mentioning vercel. That is what rules out a preflight inside our own scripts, since the
deploy that caused the outage never went through them.

[WARNING] This half is useless alone and is meant to be. It makes the question answerable;
it refuses nothing. Shipping it without half two leaves the gap open, and shipping half two
first would refuse legitimate releases. The ordering is deliberate and stated on the card.

[WARNING] The marker is a mistake-guard, not a security boundary. Anyone can create the file.
Right strength for the failure it addresses, wrong strength for an adversary, and nobody
should later cite it as the second.

[CONVENTION] No em dashes added anywhere in the diff, counted on added lines only.

### Final Ledger

Three files, 92 insertions, 0 deletions. The export now writes .kosmos-release-export with
its commit and timestamp, best-effort so a marking failure cannot fail a release. Suite green
before and after; three arms red on demand.

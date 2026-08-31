---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: reports-wording-guard
diff_hash: 5e84a345e54d9d3e8a2ae56fd93851f7b126492a75b52ca79df218be8ab5f461
timestamp: 2026-08-31T16:55:27Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

Single-pass self review with per-arm perturbation. `explicit_override` set by me and named here rather than buried: no challenge-loop skill, no review agent.

[STRENGTH] **All five arms were proven able to fail, individually**, and each perturbation asserted it had applied before its result was counted. A guard is verified by failing on demand, not by passing.

[STRENGTH] The redundancy question was settled by MEASUREMENT, not opinion. Deleting the #1673 defaults section reproduces the pinned v6 fingerprint exactly, so that half is already guarded and a second test there would be decoration. This stopped a colleague writing one.

[STRENGTH] Properties, not prose. The assertion this replaces in spirit (server.offline-nextmove) pinned an exact string and became the hazard it was written to prevent.

[STRENGTH] Boundary agreed with PigeonPete IN ADVANCE rather than discovered in review: his test asserts delivered content after boot, mine asserts `blockBody` output. Two questions, no duplication.

[WARNING] These assert what `blockBody` returns, not what reaches an agent. A green here is compatible with the text never being delivered, which is the whole of kosmos#1676. **The two tests are only meaningful together**, and I would not want this one cited alone as evidence the wording reaches anybody.

[NIT] Arm 3's perturbation reds two tests rather than one, because removing `personLine()` breaks both the naming assertion and the helper assertion. Expected, and noted so the count is not read as a surprise.

[CONVENTION] No em dashes added, checked before writing.

### Final Ledger

One new test file, one plan. 5 tests, 5 pass, 0 fail, and 5 for 5 on the red arms.

---
method: challenge-loop
branch: agents-create-agents-1279
diff_hash: 4fdeb25eb62728025c00cd202290875f7913fa2b1c4347ec9acfb86c9d616433
subdir_audit: passed
---

# Challenge-loop ledger — #1279 (agents create agents: createTeam + provenance)

Three rounds of fresh, blind CTO-lens review (each a separate agent with no prior
context), fixes applied and perturbation-verified between rounds, converged when a
round surfaced no blockers and no warnings.

#### Iteration 1

[WARNING] `created[].id` was always null in production. The real `create.createAgent`
return carries no `id` field (it is minted into the profile/birth-record and read
back separately), but the hermetic test's fake returned an `id` the real function
never produces, so the assertion passed against a shape production never emits.
Fixed: team reads the id back from the profile by the agent's slug via an injectable
`readAgentId` seam (the same #170 source create uses); the fake now returns the real
no-id shape; added a #1279 INTEGRATION test that drives the REAL create.createAgent
and asserts each created id equals the minted profile id. Perturbation: reverting to
`out.id` turns the integration test red.

[NIT] The "byte-identical" backward-compat claim was literally false (a new plain
create now carries two extra null keys). Softened to "functionally unchanged", noting
on-disk records and the only consumer (register.js) are unaffected.

[NIT] Duplicate-member names were unexercised. Added a stateful-fake test: the second
same-named member is refused by createAgent -> partial.

#### Iteration 2

[WARNING] The cap escape hatch sat in the same channel it bounds. `opts.cap` had first
precedence, but `opts` carries `members` (the model's request), so a naive authoring
seam forwarding a model-supplied cap would defeat the runaway guard the file
emphatically promises. Fixed: the cap override now comes ONLY from the trusted channel
(`deps.cap` then `AGENT_WORKFORCE_TEAM_CAP` env), never `opts`; `resolveCap` takes
`deps`, not `opts`. New test "opts.cap is IGNORED" proves the request cannot raise its
own bound. Perturbation: reverting `resolveCap(deps,env)` to `resolveCap(opts,env)`
turns the security test red.

[NIT] No absolute ceiling on the cap. Added `MAX_TEAM_CAP=50`, a hard bound even a
trusted override cannot exceed, with a ceiling test.

[NIT] `created[].name` returned the slug and dropped `shownAs` (display name). Now
returns both. The hermetic fake now slugifies (name != input) so the slug/display
divergence and read-back-by-slug are genuinely exercised.

#### Iteration 3

[STRENGTH] All prior fixes confirmed correct: the id read-back keys on the same slug
create records, verified against the real function by the integration test; the cap
security property holds (no path from opts into the cap); backward-compat confirmed
against every birth-log consumer (register.js and server.js read only outcome/name/at).

[NIT] Could team's id read-back disagree with create's birth-record id under DRY_RUN
with a stale same-slug profile? Investigated and resolved by PROOF rather than a guard:
create only answers CREATED for a slug with no prior profile (the name-taken guard
refuses one that already has a profile), so on the only path team reads the id back a
real create just minted the profile and a DRY_RUN create wrote nothing with no stale
profile to find. They cannot disagree. Documented the reasoning and added two reachable
tests (DRY_RUN fresh slug -> id null on both; duplicate slug -> refused, never reaching
the read-back). A DRY_RUN guard would have been dead code for an unreachable case.

### Final Ledger

Converged at iteration 3: no blockers, no warnings, the one completeness NIT resolved
by verification. Every fix perturbation-verified. team.test.js 15, create.test.js 152,
register.test.js 22 — 189 tests green. Diff is additive to create.js (two nullable
birth-record keys, no signature change) plus a new engine/team.js module; the only
birth-log consumers are unaffected.

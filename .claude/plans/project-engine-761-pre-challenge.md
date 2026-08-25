---
pre_challenge: true
method: challenge-loop
branch: project-engine-761
diff_hash: 92e838d20c197ebf76d1a3abf7730e6073a7856da3b6c5f0d23ee49e7881b974
subdir_audit: passed
timestamp: 2026-08-25T06:02:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 returned nothing new)
**Total findings:** 20 actionable (2 BLOCKER, 9 WARNING, 2 CONVENTION), plus NITs and STRENGTHs
**Fixed:** 18 | **Deferred:** 2 (both filed/carded)

Run by hand, following `~/.claude/skills/challenge-loop/SKILL.md` step by step (the Skill tool could not resolve `challenge-loop` in this session — `~/.claude-account-c` had no `skills/` directory at all until a fleet-wide fix landed mid-session; the diff-hash mechanism below is unaffected either way).

### Per-Iteration Breakdown

#### Iteration 1 — the original #761 diff
**New findings:** 1 BLOCKER, 3 WARNING, 2 CONVENTION
- [BLOCKER] server.js heardBy — always read the parent TASK's sentence, so an agent given a PART heard the task's original wording, not the part it was actually given --> FIXED (cd4f7c9): sentence made an explicit call-site argument.
- [WARNING] server.js partMake/partAct — the new pane-page capability had no rate limit, unlike taskMake's 12/hour valve --> FIXED (cd4f7c9): extended the valve (later found broken in iteration 2, see below).
- [WARNING] server.js assignPart — reassigning a part to the same agent re-typed the same pane line every time --> FIXED (cd4f7c9): `changed`/`moved` flag gates it (#304's rule extended to parts).
- [WARNING] engine/tasks.js addPart/assignPart — no check that `who` is a project member, unlike create() --> FIXED (cd4f7c9): same refusal as create().
- [CONVENTION] engine/projects.js — inline `require('node:crypto')` mid-function --> FIXED (cd4f7c9): moved to top-of-file requires.
- [CONVENTION] server.test.js — no heard test for partMake/partAct --> FIXED (cd4f7c9): new test added (own sentence, no-op dedup, non-member refusal).

#### Iteration 2 — iteration 1's own fix
**New findings:** 1 BLOCKER, 1 WARNING
- [BLOCKER] server.js heardBudgetAllows — iteration 1's rate-limit fix reused taskMake's persisted `addedVia==='process'` task counter, but addPart/assignPart never set `addedVia` on anything, so the counter never moved and the cap was a silent no-op --> FIXED (90798bf): real, dedicated in-memory rolling-window counter (`heardBudgetLog`, module-scope).
- [WARNING] server.js partMake — passed the raw, untrimmed request-body sentence into the pane line instead of the trimmed value addPart actually stored --> FIXED (90798bf): reads the sentence back off the part it just created, the same way partAct already did.
- Duplicates of prior findings (confirmed resolved): none (iteration 2 targeted iteration 1's fix, not the original diff).

#### Iteration 3 — the fix, again
**New findings:** 1 WARNING, 2 NIT
- [WARNING] server.js — task-creation and the part routes each had their own separate 12/hour valve, so a process could generate up to 24 pane interruptions/hour rather than 12 --> FIXED (17068bf): all three call sites share one `heardBudgetLog` budget.
- [NIT] engine/tasks.js — `writeParts`'s own `changed` (merged task record) and `assignPart`'s unrelated `changed` (who-moved flag) sat a few lines apart with the same name --> FIXED (17068bf): renamed to `moved` internally (returned field name unchanged).
- [NIT] engine/projects.js — the file-list stamp's `\0`/`\n` separator could in principle collide with a filename containing `\n` --> comment added (17068bf), fully fixed in iteration 5.
- Attempted a fourth test proving task-creation and the part routes share one budget end to end; removed it (17068bf) rather than ship it flaky — an unrelated pre-existing test in the same file already trips task-creation's own PERSISTED valve globally for the rest of the file's run, so a real non-screen task-creation call anywhere after it 429s regardless of this fix. Verified instead by code inspection (both call sites invoke the same two functions) plus iteration 2's mechanism test.

#### Iteration 4 — thin round
**New findings:** 1 CONVENTION
- [CONVENTION] engine/tasks.js — the membership guard on addPart/assignPart had no engine-level unit test, unlike create()'s identical guard which has a dedicated one --> FIXED (bec486e): sibling test added at the same layer.
- Duplicates of prior findings (confirmed resolved): 2 NITs re-raised from iteration 3, already fixed/in progress.

#### Iteration 5
**New findings:** 2 WARNING, 1 NIT
- [WARNING] server.js heardBy/tellEveryoneOn — each fetched its own roster snapshot (a real tmux capture-pane fan-out) independently of the caller's already-fetched one, doubling that cost per assignment --> FIXED (474269a): both take an optional roster parameter; the three #761 routes compute one roster per request and pass it through; the pre-existing unrelated close/reopen route is untouched (no argument passed there, so it still fetches its own exactly as before).
- [WARNING] engine/tasks.js addPart/assignPart — no persisted write-level rate limit on part creation/reassignment itself, unlike task/project creation (only the pane-page side effect is valved) --> DEFERRED: real, pre-existing-shaped gap (parts could already trigger unlimited instruction-file rewrites before #761), broader than this PR (project-membership routes share the same shape), filed as [kosmos#803](https://github.com/joshualeestone/kosmos/issues/803) rather than folded into a notification feature.
- [NIT] engine/projects.js — the stamp's `\0`/`\n` separator caveat (iteration 3) --> FIXED (474269a) for real: each record JSON-encoded before hashing, removing the caveat rather than documenting around it.

#### Iteration 6 — the fix layer, again
**New findings:** 2 WARNING, 1 NIT
- [WARNING] engine/tasks.js assignPart — the membership check ran unconditionally, so resubmitting a part's CURRENT assignee (a harmless no-op) started throwing a hard 400 the moment that agent left the project (removal never clears a part's `who`) --> FIXED (1027f96): the check now runs only when `who` is actually moving; a genuine new assignment to a departed agent is still refused (regression test added).
- [WARNING] server.js heardBudgetRecord — fired on ANY heardBy result, including a FAILED delivery (could_not/unconfirmed) to an unreachable agent, so repeated failed attempts at one dead agent could exhaust the shared budget for every other project's real placements --> FIXED (1027f96): only `chat.DELIVERY.PLACED` spends the budget (regression test: 15 failed attempts don't block a real delivery afterward).
- [NIT] server.js isViaScreen — parameter named `req2` with no shadowing to avoid --> FIXED (1027f96): renamed to `req`.
- **Both of this round's findings are the same shape, and it is the sharpest thing this loop surfaced**: a fix introducing a failure worse than the defect it cured. Before #761 touched either area, neither failure mode existed — a departed agent's stale part assignment was inert, and there was no shared notification budget to exhaust. The round-1 and round-3/5 fixes created both. Recorded here as the loop's own evidence for why the fix layer gets re-reviewed, not skipped.

#### Iteration 7 — converged
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT (both re-flagging findings already deferred in iteration 5 with reasoning: heardBy's extra store read for the project title, and small structural duplication across the three route call sites)
**Converged** — no new actionable findings; all 145 engine tests and 242 server tests pass fresh.

### Bound, stated out loud (per operator exchange mid-loop)

No bound was pre-registered before starting. When asked directly at iteration 7 (in flight), the trajectory was measured round by round rather than asserted: iterations 1-3 found things in the original diff; iteration 4 was thin; iteration 5 found a real cost issue plus a deferred scope card; iteration 6 found two functional regressions in this branch's OWN earlier fixes. The bound set at that point: judge iteration 7 on whether it targets the original/cumulative code (real) or iteration 6's wording (not); if substantive, one more round to verify convergence; stop after iteration 8 regardless of outcome. Iteration 7 came back thin (no BLOCKER/WARNING/CONVENTION, only already-deferred NITs) — converged there, under the bound, with an iteration to spare.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.js heardBy | read the task's sentence, not the part's | FIXED | cd4f7c9 |
| 2 | 1 | WARNING | server.js partMake/partAct | new pane-page capability, no rate limit | FIXED | cd4f7c9 (rework: 90798bf, 17068bf) |
| 3 | 1 | WARNING | server.js assignPart | no-op reassignment re-typed the pane line | FIXED | cd4f7c9 |
| 4 | 1 | WARNING | engine/tasks.js addPart/assignPart | no membership check | FIXED | cd4f7c9 |
| 5 | 1 | CONVENTION | engine/projects.js | inline require('node:crypto') | FIXED | cd4f7c9 |
| 6 | 1 | CONVENTION | server.test.js | no heard test for parts | FIXED | cd4f7c9 |
| 7 | 2 | BLOCKER | server.js heardBudgetAllows | rate-limit fix was a silent no-op | FIXED | 90798bf |
| 8 | 2 | WARNING | server.js partMake | raw untrimmed sentence in pane line | FIXED | 90798bf |
| 9 | 3 | WARNING | server.js | two valves combined to 24/hour, not 12 | FIXED | 17068bf |
| 10 | 3 | NIT | engine/tasks.js | `changed` name collision across scopes | FIXED | 17068bf |
| 11 | 4 | CONVENTION | engine/tasks.js | no engine-level test for membership guard | FIXED | bec486e |
| 12 | 5 | WARNING | server.js | heardBy/tellEveryoneOn duplicate roster fetch | FIXED | 474269a |
| 13 | 5 | WARNING | engine/tasks.js | no write-level valve on parts | DEFERRED | kosmos#803 |
| 14 | 5 | NIT | engine/projects.js | stamp separator collision | FIXED | 474269a |
| 15 | 6 | WARNING | engine/tasks.js assignPart | membership check broke idempotent resubmit | FIXED | 1027f96 |
| 16 | 6 | WARNING | server.js heardBudgetRecord | failed deliveries spent the shared budget | FIXED | 1027f96 |
| 17 | 6 | NIT | server.js isViaScreen | param named req2, no shadowing to avoid | FIXED | 1027f96 |
| 18 | 7 | NIT | server.js heardBy | title lookup re-reads the store | DEFERRED | same reasoning as #12/#803's scope call |
| 19 | 7 | NIT | server.js | small duplication across 3 route call sites | DEFERRED | readability preference, not correctness |

### NITs (non-blocking, across all iterations)
- [NIT] engine/projects.js:1159 — stamp hashed on every listFiles call, O(n) on a 5s poll; fine at normal project sizes (iteration 6).
- [NIT] server.js — heardBy's title lookup re-reads the project store rather than threading a value already in scope a few lines up (iterations 2, 4, 7 — consistently deferred).
- [NIT] server.js — small structural duplication of the "attempt heard within budget, record on success" pattern across taskMake/partMake/partAct (iteration 7).

### Strengths (across all iterations)
- Each fix shipped with a dedicated regression test carrying an explicit CONTROL assertion, not just a happy-path check (iterations 1, 2, 6).
- The membership check and the shared budget both correctly fail the WRITE whole (inside `projects.mutate`'s atomic callback) rather than partially landing (iterations 1, 4).
- Free-text sentences delivered into a live agent's pane inherit `chat.deliver`'s existing control-character refusal rather than needing new sanitization (iteration 5, confirmed iteration 7).
- The two genuine functional regressions iteration 6 found were both in this branch's own fix-layer code, not the original diff — direct evidence the loop earned iterations 5 and 6 rather than padding them.

---
pre_challenge: true
method: challenge-loop
branch: badge-observed-1921
diff_hash: 7c3e013cbe0c2b8b7394aa245c60c9c67f455f1d89e66a7b110b4b2a8c250c77
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T03:43:45Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 produced no new BLOCKER/WARNING/CONVENTION after dedup)
**Total findings:** 1 BLOCKER, 4 WARNINGs, 5 CONVENTIONs/NITs
**Fixed:** most | **Deferred:** 1 (to #1959) + a few NITs by design | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 1 WARNING, 3 NITs
- [BLOCKER] engine/status.js observation + server.js join -- cross-provider contamination: a codex/OpenAI agent also classifies WORKING and, on the default codex home, has configDir=null which accountForAgent maps to the DEFAULT Claude account, so a working codex agent would green a Claude account it has nothing to do with --> FIXED (gate the observation to non-codex panes: `pane.runner === 'codex' || isCodexCommand(pane.command)`, byte-identical to classify()'s own codex test)
- [WARNING] server/status tests -- no test pinned the codex contamination --> FIXED (added a non-vacuous codex test: the pane is asserted WORKING before asserting nothing is recorded)
- [NIT] web/index.html -- back-compat render comment omitted that OpenAI rows also use the legacy fallback --> FIXED
- [NIT] engine/observed.js -- store never pruned --> documented (bounded, freshness-gated)
- [NIT] engine/observed.js -- verdict "precedence" framing over-implied both fresh arms live at once --> FIXED (comment)

#### Iteration 2
**New findings:** 1 WARNING, 1 NIT (+1 duplicate)
- [WARNING] web/index.html other consumers -- the honesty fix is surface-local; account picker / move-eligibility / "any signed in" summaries still read `connection.state === 'connected'` --> DEFERRED (explicit plan non-goal, not a regression; tracked as #1959)
- [NIT] .claude/plans/badge-observed-1921.md -- 20 em dashes (house no-em-dash rule; ships in the PR diff) --> FIXED
- [NIT] engine/observed.js store retention -- duplicate of iteration 1, confirmed documented

#### Iteration 3
**New findings:** 1 WARNING, 2 NITs (acceptable/duplicate)
- [WARNING] engine/status.js -- the WORKING->ok justification ("actively streaming turn") overstated: status.state===WORKING can also come from a fresh SELF-REPORT (a claim, not a witnessed outcome) --> FIXED (wording corrected; behavior deferred to iter 4's sharper finding)
- [NIT] agoWords hour/day bands unreachable via this caller; [NIT] store retention -- both acceptable/documented

#### Iteration 4
**New findings:** 2 WARNINGs, 2 NITs
- [WARNING] engine/status.js + engine/observed.js -- a fresh self-reported WORKING reconciles to status.state===WORKING over an idle scrape and can sit above a checkLive===none, so recording ok from status.state would paint GREEN over a hard negative (the exact false-green class) --> FIXED (record ok ONLY from the WITNESSED scrape, `scrapedStatus.state===WORKING`; REJECTED stays post-reconcile for #1930 suppression) + a non-vacuous self-report test
- [WARNING] web/index.html green copy overstated for the self-report case --> RESOLVED by the fix (green is now witnessed, so the copy is accurate)
- [NIT] agoWords unreachable bands; [NIT] web-test source-regex brittleness --> DEFERRED (mirrors freshWords; established source-assertion convention with behavioral coverage elsewhere)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** -- no new actionable findings.
- [NIT] engine/status.js -- OK arm reads the raw scrape so it does not inherit #1930's stale-scrollback suppression the REJECTED arm gets; a stale streaming line could record a brief ok --> documented inline (self-heals in the ~60s sweep, freshness-capped; a false green self-heals whereas a false 401 would wrongly tell a paying customer they are disconnected)
- [NIT] engine/observed.js store retention -- duplicate, confirmed documented

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | status.js/server.js | cross-provider codex contamination greens default Claude badge | FIXED | codex write-gate + test |
| 2 | 1 | WARNING | tests | codex contamination unpinned | FIXED | non-vacuous codex test |
| 3 | 1 | NIT | web/index.html | legacy-render comment omits OpenAI rows | FIXED | comment |
| 4 | 1 | NIT | observed.js | store never pruned | DEFERRED | bounded + documented |
| 5 | 1 | NIT | observed.js | verdict precedence framing | FIXED | comment |
| 6 | 2 | WARNING | web consumers | surface-local honesty (other state===connected readers) | DEFERRED | plan non-goal; #1959 |
| 7 | 2 | NIT | plan | em dashes | FIXED | replaced with -- |
| 8 | 3 | WARNING | status.js | WORKING wording over-trust | FIXED | wording (superseded by #9) |
| 9 | 4 | WARNING | status.js/observed.js | self-report false-green over checkLive none | FIXED | ok from witnessed scrape + test |
| 10 | 4 | WARNING | web copy | green copy overstates | FIXED | resolved by #9 |
| 11 | 4 | NIT | web/index.html | agoWords unreachable bands | DEFERRED | mirrors freshWords |
| 12 | 4 | NIT | web test | source-regex brittleness | DEFERRED | convention; behavioral coverage exists |
| 13 | 5 | NIT | status.js | OK arm lacks stale-scrollback suppression | DEFERRED | documented; self-heals + freshness-capped |

### Deferred (with reasoning)
- #6: other `connection.state` consumers -- explicit plan non-goal, pre-existing behavior, tracked as **#1959** (which also carries the #1930 authprobe open question).
- NITs 4/11/12/13: bounded/acceptable/consistent-with-convention, each documented inline.

### Strengths (across iterations)
- Non-vacuous, presence-before-absence tests at every layer (the fix asserts the would-record state before asserting no record).
- The OK(witnessed scrape)/REJECTED(post-reconcile) split is correct and consistent; the codex gate is byte-identical to classify()'s own codex test so the two derivations cannot drift.
- The join reuses the existing accountForAgent rather than re-deriving the agent->account mapping; keys on `.dir` consistently on both sides.
- Freshness gates both positive and negative verdicts; clock-skew handled; the observation write is best-effort so it can never sink the snapshot tick; OpenAI rows and other listLive callers are not regressed.

### Validation
Full suite `bash tools/run-tests.sh`: 3923 pass, 0 fail, run SOLO (verified box tenancy with the tight `ps` pattern; an earlier run showed 4 release-gate reds that were confirmed foreign shared-state flake from a concurrent 0.6.24 release cut -- `tools.release-gate.test.js` passes 22/22 in isolation and is untouched by this diff).

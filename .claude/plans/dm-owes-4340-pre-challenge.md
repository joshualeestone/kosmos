---
pre_challenge: true
method: challenge-loop
branch: dm-owes-4340
diff_hash: 3da8467af06b05c64fe2f55c823613c07c277d50616843e600a1f96ef11ebe0c
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T15:35:52Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes, at iteration 8
**Total findings:** 1 BLOCKER, 7 WARNINGs, 1 CONVENTION, 16 NITs
**Resolved:** the BLOCKER and 2 WARNINGs by REMOVING the code they were about (toQuestion, answersQuestion); 5
WARNINGs and the CONVENTION fixed; 1 WARNING decided and ruled (the daily-limit notice, Liu Kang m2410, follow-up
#4354). NITs: 11 fixed, 5 deferred. **Asked (awaiting user):** 0

Validation: `yarn test` via validation-log, gated on tools/heavy-gate.sh, PASSED for hash 3da8467af06b at de936f8:
11267 tests, 11102 pass, 0 fail, 165 skipped; the #4306 run-root leak guard green. Both browser-check gates pass.
Browser check render-dm-owes-4340.js at 4090a60 (same page and check as de936f8): all good; with chat.dmOwes forced
to clear, 5 lines fail. Route test RED on main (a placed DM never owed; a colleague's msg owed), measured.

**Disclosure.** Iterations 3 and 4 added `toQuestion` / `answersQuestion` to excuse a typed answer to the agent's
question. Iteration 5 showed that rested on a wrong model (appendMessage never stored the field; the "fresher" read
was the same snapshot; NEEDS_YOU is wider than a question on screen). It was removed, not patched, and a typed
answer is a documented KNOWN LIMIT pinned by a test. A first version of the writer test wrote one thread file
(only its own two rows) into the real Kosmos data root; the file was deleted and the test sandboxed and asserted.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] a menu answer (wire) counted as owed --> FIXED (ba0f173)
- [WARNING] messages.owesReply left with no production caller (engine.reachable's shape) --> FIXED (deleted with its tests)
- [NIT] route matched on card.sessionName, not the read key --> FIXED (name)
- [NIT] dmOwes split the #2863 comment from DM_SEEN --> FIXED
- [NIT] "two writers" docblock claim --> FIXED
- [NIT] unknown state untested at the route --> FIXED (cut-short file)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] Kosmos's daily-limit notice (in the agent's name) clears the debt --> DECIDED keep (plan); Liu Kang RULED keep (m2410); it clears for good, measured; follow-up #4354 filed

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a typed answer to the agent's question counted as owed --> "fixed" with toQuestion (b70d4c4), later REMOVED (iteration 5); now a KNOWN LIMIT
- [NIT] page grace timed from a menu answer --> FIXED (then made moot by iteration 6's single derivation)
- [NIT] unknown sentence said "message record" --> FIXED ("this conversation")
- [NIT] browser check did not assert rows rendered; no menu arm --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] toQuestion decided from a stale card --> answersQuestion (3a40806), later REMOVED
- [WARNING] toQuestion producer only regex-pinned --> answersQuestion tests, later REMOVED

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] toQuestion never stored (appendMessage keeps a fixed field list) --> REMOVED the feature (ebf3f61)
- [WARNING] answersQuestion's two reads are one snapshot --> REMOVED
- [WARNING] NEEDS_YOU wider than "a question is on screen" (reported needs_you, failed restart) --> REMOVED; typed answer is a KNOWN LIMIT
- [NIT] docblock order; README arms; browser arms only engine-checked --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
- [CONVENTION] the page re-derived the owed message instead of using owes.lastHeardAt (convention #5) --> FIXED (4090a60: dmOwesLine(owes), timed from lastHeardAt; page tests run the real dmOwes)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] owes computed after the 200-row tail; a tail of menu answers could hide an owed DM --> FIXED (de936f8: before the slice; route test with 201 menu answers; source-order pin; both red in the old order)
- [CONVENTION-level stale comment] dmOwes docblock named a page rule that no longer exists --> FIXED
- [NIT] unused rows parameter in the web test helper --> FIXED; [NIT] no unknown/search arm in the browser check --> DEFERRED (both pinned at unit level); [NIT] plan did not link #4354 --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
- [NIT] web.owes-line.test.js still passes an ignored rows argument at four call sites --> DEFERRED (cosmetic; the helper takes one argument)
**Converged:** no BLOCKER, WARNING or CONVENTION findings.

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | menu answer counted as owed | FIXED | ba0f173 |
| 2 | 1 | WARNING | owesReply dead after the change | FIXED | ba0f173 (deleted) |
| 3 | 2 | WARNING | daily-limit notice clears the debt | DECIDED | ruled keep; #4354 |
| 4 | 3 | WARNING | typed answer counted as owed | KNOWN LIMIT | toQuestion removed at ebf3f61 |
| 5 | 4 | WARNING | toQuestion from a stale card | REMOVED | ebf3f61 |
| 6 | 4 | WARNING | toQuestion producer only pinned | REMOVED | ebf3f61 |
| 7 | 5 | BLOCKER | toQuestion never stored | REMOVED | ebf3f61 |
| 8 | 5 | WARNING | two reads are one snapshot | REMOVED | ebf3f61 |
| 9 | 5 | WARNING | NEEDS_YOU too wide | REMOVED | ebf3f61 |
| 10 | 6 | CONVENTION | page re-derived the owed message | FIXED | 4090a60 |
| 11 | 7 | WARNING | owes after the 200-row tail | FIXED | de936f8 |

### Deferred NITs
- iteration 7: no unknown or search-box arm in the browser check (both pinned at unit level)
- iteration 8: an ignored rows argument at four web test call sites
- earlier: none outstanding beyond these

### Strengths
- owes comes from the one-to-one thread the page draws, on the full stored rows, before the question and account rows are injected (iterations 1, 7, 8)
- one derivation: the page draws the engine's answer, timed from lastHeardAt (iterations 6, 7, 8)
- tests go through the real writer and the real route in sandboxes, with controls; the browser check computes owes with the real engine (iterations 5, 7, 8)

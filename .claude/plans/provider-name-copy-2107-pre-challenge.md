---
pre_challenge: true
method: challenge-loop
branch: provider-name-copy-2107
diff_hash: 44ef2fc797d2c879aa15d5f1c7be54829fa44a5b7d63e38fd9a614592937694f
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T05:19:42Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned no new findings; its only note dedups against iteration 1's deferred CONVENTION)
**Total findings:** 1 CONVENTION (0 BLOCKERs, 0 WARNINGs)
**Fixed:** 0 | **Deferred:** 1 CONVENTION | **Asked:** 0

### Change under review (#2107, chat.js half)

`engine/chat.js`'s `waitingNote` AUTH_FAILED note said "its Claude sign-in was not working" for any
runner. A running codex agent fronts as a node process, passes the messageable gate, and stays
reachable (#571), so a codex pane classifying AUTH_FAILED showed its OpenAI owner a Claude-named
message. Fix: `waitingNote(state, outcome, runner)` names the runner (`runner === 'codex' ? 'Codex'
: 'Claude'`, the chat.js:520 pattern); `deliver` passes `allowed.card.runner`. New unit test. The
four status.js sibling sites are deliberately phased to a later PR behind another agent's active
status.js work (Renet's #2093), not omitted.

Reviews were run by two fresh, blind challenge agents (no knowledge of prior findings).

### Per-Iteration Breakdown

#### Iteration 1
0 BLOCKING. Verified by measurement: `allowed.card.runner` is in scope and non-null at the call site (deliver returns early on `!allowed.ok`; the ok:true card is always defined); it is the card the send was authorised against; `card.runner` is normalized to `'codex'` or `''` (status.js:888) so every non-codex value degrades to Claude (the safe pre-change behavior); `deliver` is the ONLY production caller (other callers are tests, 2-arg, backward-compatible); the test is non-vacuous (2 of 4 red on origin/main); `engine/chat.test.js` 116/116 (no regression); no other in-scope Claude-hardcoded string; no em dashes.
- [CONVENTION] chat.waitingnote-provider-2107.test.js:57 the source-plumbing assertion matches the exact literal `waitingNote(paneState, outcome, allowed.card.runner)`, so it is whitespace/spelling-brittle to a reformat of that call site --> DEFERRED: this is the intended guard (it proves the plumbing is armed and correctly reds on origin/main); the brittleness is the accepted cost of pinning the call. A future editor of chat.js:812 updates it in lockstep.

#### Iteration 2
**Converged** -- 0 BLOCKING, 0 WARNING. A second independent blind pass re-verified everything: swapped in origin/main:engine/chat.js and confirmed the new test reds (source-plumbing assertion + Codex-name strings) then restored the worktree clean; both suites pass on branch (4/4 + 116/116); the degrade holds for `''`/`'claude'`/`undefined`/`null`; the existing chat.test.js:896-901 regression tests (2-arg waitingNote, exact old Claude strings) still green, proving Claude behavior is byte-identical; no other broken caller; copy reads correctly on both the confirmed and unconfirmed branches.
- [CONVENTION] the same source-plumbing test brittleness --> DUPLICATE of iteration 1's deferred finding; dedups away. No new findings.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | CONVENTION | chat.waitingnote-provider-2107.test.js | source-plumbing assertion is whitespace-brittle | DEFERRED (intended guard) |

### Outstanding questions (ASKED)
None.

### Validation

`tools/run-tests.sh` -> VAL_EXIT=0. Unit test 4/4; `engine/chat.test.js` 116/116 (no regression from
the added arity). The test reds on origin/main (2-arg waitingNote returns Claude; the source-pin is
absent), proving non-vacuity. This is an engine/ change, so the #1720 browser-check gate does not
apply. Live-codex e2e is the #2099 morning-cluster dependency, noted not blocked.

### Strengths (iteration 2)
- [STRENGTH] Non-vacuity was PROVEN, not assumed: origin/main:engine/chat.js was swapped in and the new test red, then the worktree was restored clean.
- [STRENGTH] Claude behavior is byte-identical to before: the pre-existing chat.test.js:896-901 regression tests (no-runner waitingNote, exact old strings) stay green, and the degrade path covers every non-codex value.
- [STRENGTH] The runner value is normalized upstream to exactly 'codex' or '' (status.js:888), so the strict `=== 'codex'` compare cannot miss a legitimate codex agent, matching the established #2100 precedent at chat.js:520.

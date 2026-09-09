---
pre_challenge: true
method: challenge-loop
branch: sleep-gate-escape
diff_hash: ba9309589174a09daca4a5351b4d546945b6fc7a697948b9ff3c6022f015547e
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T19:07:39Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (blind, model-rotated: sonnet/opus alternating), across a mid-loop design pivot.
**Converged:** Yes -- the final two passes (sonnet iter-A, opus final) on the shipped ADVISORY design found zero NEW BLOCKER/WARNING/CONVENTION.
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, ~9 NITs.
**Fixed:** all WARNINGs + the actionable NITs | **Deferred:** 0 | **Asked:** 0

### The pivot (why 6 iterations across two designs)
The branch first built a laptop-only "Continue anyway" ESCAPE (iters 1-4, converged). Then Josh ruled in-channel (Mona synthesized + routed to me): do not gate Next on the sleep permission at all -- "just hit Next and not get stuck." The escape was REPLACED by making the sleep step ADVISORY (`FR_GATES.sleep gatesNext:false`; `frPollGates` exempts only gatesNext:false rows from anyBlocked). Two fresh blind passes then reviewed the advisory design to convergence. The final diff is the advisory state; the escape is fully removed (markup/CSS/handler/data-continued gone).

### Per-Iteration Breakdown
#### Iters 1-4 (escape design, later superseded by Josh's ruling) -- sonnet/opus/sonnet/opus
Converged on the escape. Real findings fixed: a11y (badge aria-label inert in a labeled button -> folded into the button name, later moot); ring/laid-out coverage; the focus-on-continue hole (focus dropped to body when tmux still blocked -> focus the caveat pill); AC-unreadable exclusion documented + pinned; test-anchor bounding; browser-check activeElement + poll-persistence arms. Self-generated: iter-2's WARNING was a hole in iter-1's own focus fix (corrected).

#### Iter A (advisory, post-pivot) -- sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (same issue), 0 CONVENTIONs.
- [WARNING] engine/machine.js + machine.test.js -- several comments still described the removed "Continue anyway" escape as if live (battOnly now only selects which informational note to show). --> FIXED (f934f226): reworded 5+ comment sites to "note"/"advisory", matching the already-correct sleepGate JSDoc.

#### Iter B (advisory, final) -- opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs. **CONVERGED.**
- 2 NITs (stale framing my change caused on sibling checks): render-gated-next.js label "needs BOTH"; click-first-run.js comment "either S3 gate must disable Next". Both still passed (tmux drives the disable), but the framing was superseded. --> FIXED (a9065bf7): relabeled/reworded to attribute the disable to Accessibility and note sleep is advisory.

### Final Ledger
| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | A | WARNING | engine/machine.js:~167/263 | BRANCH | Comments describe the removed "Continue anyway" escape as live | FIXED | f934f226 |
| 2 | A | WARNING | engine/machine.test.js:~876 | BRANCH | Same stale-escape language in test comments | FIXED | f934f226 |
| 3 | B | NIT | render-gated-next.js:151 | BRANCH | "needs BOTH" label stale (sleep no longer gates) | FIXED | a9065bf7 |
| 4 | B | NIT | click-first-run.js:344 | BRANCH | "either S3 gate must disable Next" comment stale | FIXED | a9065bf7 |

### Outstanding questions (ASKED): none.

### What shipped (the advisory design)
- `FR_GATES.sleep gatesNext:false`; `frPollGates` only lets a blocked row set anyBlocked when its spec is NOT gatesNext:false. Sleep never gates Next (laptop OR desktop). Accessibility/tmux + file-access STILL gate (satisfiable + required; ungating would land users in broken agents).
- The honest laptop note (Mona's copy) replaces the useless Turn On on the battOnly row (info only). No "Continue anyway" button / data-continued.
- engine sleepGate reading unchanged (prevented:false stays honest; battOnly flags the laptop-note case, absent on the AC-unreadable branch -- pinned negatively at both layers).

### Verification
- Full `run-tests.sh` EXIT=0 at f934f226 (final code); node + browser-check registry tests 93/93 at the final a9065bf7 (the a9065bf7 delta is comment/label only in two browser-check files, inert to the node suite).
- `render-gated-next.js` (#1720 net browser-check) drives the real page: (A) a blocked sleep row does NOT gate Next + the note shows + not green + no Continue button; (B) Accessibility NOT granted still LOCKS Next (the load-bearing control -- proves no bypass into broken agents); (C) a fixable desktop is advisory too but keeps Turn On. Green on the final HEAD.

### NITs (non-blocking): the escape iterations' polish (folded/moot post-pivot); the two sibling-framing NITs (fixed above).

### Strengths
- Sleep truly never gates Next (gatesNext:false only on sleep, verified); Accessibility/file-access still gate.
- No false green: data-granted only on granted; battOnly rows are prevented:false; engine verdict stays honest, gating is web-only.
- The removed escape is fully gone (only in doesNotMatch guards + the absence probe).
- Browser-check arm B is a genuine control that can return the dangerous answer; the AC-unreadable exclusion is pinned negatively at both layers.

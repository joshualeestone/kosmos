---
pre_challenge: true
method: challenge-loop
branch: view-agent-buttons-0644
diff_hash: 3917a990669637dfc87660aab36a61bf501854e1daa6251c1e644d59c2888b31
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T07:37:44Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 produced zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs)
**Fixed:** 3 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] web/index.html openDetail — the two new receipt slots (d-open-terminal-msg /
  d-trust-restart-msg) were not cleared on agent switch, so agent A's receipt/error could stand
  under agent B (the #149/#150 wrong-agent-misattribution hazard the panel already guards for other
  slots). The handlers' capture-and-recheck only covers an in-flight POST, not a receipt that already
  landed for A --> FIXED (clears both slots in openDetail; commit 466802f0-line block)
- [NIT] render checks do not exercise the bad-name/500 {error} fallback --> DEFERRED: the covered
  paths (200/400/503/throw/URL-encode/POST) are complete; `|| r.error` is a trivial fallback line.
- 3 STRENGTHs (thorough checks, narrow #996 exemption, no XSS/textContent, plan+weakest-premise disclosure).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs (1 new, 1 = deferred #996 residual)
- [CONVENTION] plan .../view-agent-buttons-0644.md — the Open Terminal contract text said the headless
  case is 400; the implemented+tested contract is 503 (Pete's amendment) --> FIXED (plan corrected to
  400 refusal / 503 env-failure, both {ok:false,because}, non-200 handled uniformly)
- [NIT] web/index.html openDetail — the shared buttons' disabled state was not reset on switch, so an
  in-flight POST for agent A left the buttons disabled for agent B until A settled --> FIXED (re-enable
  both buttons in openDetail; the leaving agent's finally re-enable is then a no-op)
- [NIT] #996 exemption strips the whole #d-term-actions section, so a future imperative added INSIDE it
  would bypass the guard --> DEFERRED: the accepted, in-comment-documented trade-off, flagged to Josh.
- 3 STRENGTHs (wrong-agent hazard fully closed - reviewer traced timings, no gap; status-agnostic
  failure handling; checks + counts + registration consistent).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both deferred)
- [NIT] web/index.html openDetail — the new clears/re-enables are unguarded (.textContent/.disabled)
  vs a null-guarded #967 sibling --> DEFERRED: they match the IMMEDIATE unguarded neighbors (d-msg,
  d-role-msg at 21188-21189); all four ids are always-present statics in the always-rendered
  #d-term-actions; the #967 guard is for a conditionally-present element. Guarding would diverge from
  the adjacent pattern.
- [NIT] error-branch coverage --> DEFERRED (dup of iteration 1).
- 4 STRENGTHs. **Converged** - zero new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html openDetail | receipt slots not cleared on switch (#149/#150) | FIXED | 466802f0 |
| 2 | 1 | NIT | render-*-0644.js | bad-name/500 {error} branch untested | DEFERRED | covered paths complete |
| 3 | 2 | CONVENTION | plan:54 | plan said 400 for headless, code/tests use 503 | FIXED | 6f87542a |
| 4 | 2 | NIT | web/index.html openDetail | shared buttons stay disabled across switch | FIXED | 6f87542a |
| 5 | 2 | NIT | web.terminal-hatch-996.test.js | exemption strips whole section (future-imperative residual) | DEFERRED | documented trade-off, flagged to Josh |
| 6 | 3 | NIT | web/index.html openDetail | unguarded clears in hot path | DEFERRED | matches adjacent unguarded d-msg/d-role-msg; ids always present |

### NITs (non-blocking, across all iterations)
- render checks skip the bad-name/500 {error} fallback (covered paths otherwise complete)
- #996 exemption strips the whole #d-term-actions section (documented residual, flagged to Josh)
- openDetail clears are unguarded (consistent with adjacent d-msg/d-role-msg)

### Strengths (across all iterations)
- The #149/#150 wrong-agent misattribution hazard is closed by TWO complementary mechanisms with no
  timing gap: capture-and-recheck (capture forAgent = CURRENT.sessionName, recheck before every write)
  for an in-flight POST, and openDetail clearing+re-enabling the shared buttons for a receipt that
  already landed. Multiple reviewers traced the interleavings and found no path landing A's receipt
  under B.
- Open Terminal's failure handling is status-code-agnostic (`r.because || r.error || fallback`),
  correctly surfacing the reason for both a 400 refusal and a 503 env failure without special-casing;
  render-open-terminal-0644.js asserts BOTH (Pete's Contract-2 amendment).
- The #996 guard exemption is narrow and exact: section-strip anchored to `id="d-term-actions"`,
  non-greedy to the first </section>, no nested sections, runs before tag-normalisation; leaves the
  guard able to catch a real "open a terminal" imperative anywhere else. Passive error copy avoids the
  imperative regex.
- Receipts inserted via textContent (no XSS); buttons type="button" with role=status aria-live=polite.
- Browser-check registration fully consistent (browser-checks.sh loop + README + reason-grep 65->67 /
  40->42), satisfying the wired/indexed/selectors/reason-grep coverage tests. Full node suite 4989/4989.

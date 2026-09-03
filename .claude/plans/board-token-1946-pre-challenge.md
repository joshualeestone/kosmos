---
pre_challenge: true
method: challenge-loop
branch: board-token-1946
diff_hash: 3ab742955b7f10b947d7e85f871ad34e12a9046d9a1b0bd59b24137ff2646c91
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T04:46:04Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (converged on iteration 7; the 6j final gate then caught one shell-guard finding, fixed and re-validated green)
**Converged:** Yes
**Total findings:** 1 BLOCKER, 11 WARNINGs, 11 NITs (plus many STRENGTHs)
**Fixed:** 18 | **Deferred (with reasoning):** 4 | **Tracked as follow-up cards:** 2 (kosmos#1968, kosmos#1970)

Every iteration found something real, which is the whole case for the blind loop on a code-execution auth surface: my own review would have shipped the iteration-3 first-run BLOCKER and the iteration-1 native-app version-probe 403.

### Per-Iteration Breakdown

#### Iteration 1 — 5 WARNINGs, 2 NITs
- [WARNING] native-app version probe GETs /api/status via URLSession.shared (separate cookie store) -> 403 on every prod board, update-nudge silently disabled --> FIXED (header)
- [WARNING] KOSMOS_URL override webview load not tokenized --> FIXED (tokenizedBoardURL)
- [WARNING] ensureToken "exactly one writer" holds only same-port; different-port double-start clobbers --> FIXED (atomic link() adopts on-disk token)
- [WARNING] native-app hardcodes token path (vs single-source) --> DEFERRED (consistent with existing accepted port-formula duplication)
- [WARNING] direct-URL-bookmark 403 UX --> DEFERRED (frontend shows the refusal message gracefully; verified)
- [NIT] ensureToken chmod only on generate --> FIXED (self-heal on existing path); [NIT] board_token node-per-call (accepted)

#### Iteration 2 — 1 WARNING, 3 NITs (mostly STRENGTHs)
- [WARNING] AGENT_WORKFORCE_DATA env-coupling: native app ignored the override --> FIXED (consult it, faithful store.ROOT port)
- [NIT] native-app comment overclaims "no hardcoded path" --> FIXED; [NIT] gateLog logs ?token= --> FIXED (redacted); [NIT] session cookie --> addressed in iter 4

#### Iteration 3 — 1 BLOCKER, 2 WARNINGs, 1 NIT
- [BLOCKER] install/setup.sh dashboard-open opened a bare URL (both pkg LaunchAgent + direct), so a fresh enforcing board's first dashboard 403'd --> FIXED (tokenized _board_url, single-sourced via bundled node)
- [WARNING] report/reply exempt: loopback caller reaches them via from_pane fallback (framing overstated protection) --> DEFERRED, framing corrected, tracked kosmos#1968
- [WARNING] direct-URL 403 --> DUPLICATE of iter 1
- [NIT] native-app omits AGENT_WORKFORCE_HOME --> FIXED

#### Iteration 4 — 3 WARNINGs, 2 NITs
- [WARNING] token in launchd plist at default umask (644) --> FIXED (chmod 600, later umask-from-creation)
- [WARNING] session cookie friction (re-raised) --> FIXED (Max-Age)
- [WARNING] sandbox predicate now a security boundary but keys on "set" not "safe stub" --> FIXED (explicit documented residual)
- [WARNING] report/reply needs a real ticket --> FIXED (filed kosmos#1968, referenced in code)
- [NIT] duplicate-header comma-join 403 (fails closed, no action); [NIT] redaction regex (correct)

#### Iteration 5 — 0 actionable, 2 NITs (7 STRENGTHs; converged on actionable)
- [NIT] empty/corrupt board.token deadlocks (EEXIST forever) --> FIXED (replace-and-heal, later re-read)
- [NIT] plist umask window --> FIXED (umask 077 subshell, owner-only from first byte)

#### Iteration 6 — 2 WARNINGs, 1 NIT
- [WARNING] the iter-5 rename recovery reintroduced a race + docstring overstated the guarantee --> FIXED (re-read after rename; docstring scoped honestly to the link-adopt path vs best-effort recovery)
- [WARNING] token delivered on process argv, readable cross-account via ps --> DEFERRED, documented, tracked kosmos#1970 (transient, cookie-swapped+stripped, matches pre-existing agent-token delivery, open/browser window partly inherent)
- [NIT] dead finally-unlink on the rename path (harmless, acknowledged)

#### Iteration 7 — 0 actionable, 2 NITs (7 STRENGTHs)
**Converged** — an independent reviewer re-confirmed: boundary complete (all account data under /api/, no pre-guard/upgrade bypass), fail-closed correct, the recovery docstring accurate, residuals faithfully scoped, tests non-vacuous.
- [NIT] readToken conflates EACCES with empty (same-account-only, reviewer marked no-action) --> DEFERRED
- [NIT] plan doc described an unbuilt /api/health --> FIXED (SHIPPED DELTA note)

#### 6j Final Validation — 1 shell-guard finding
- [BLOCKER] final-validation: installer runnable-guard flagged a bare `[ -x "$_awnode" ]` in setup.sh (a +x directory passes) -- caught by the full shell-test phase the per-iteration node-direct runs had skipped --> FIXED (`[ -f ] && [ -x ]`). Re-validated: node 3917/0, all shell guards 0 failures, validation PASSED.

### Final Ledger (actionable findings)

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | native-app/main.swift | version probe 403 on prod | FIXED | header on URLSession |
| 2 | 1 | WARNING | native-app/main.swift | KOSMOS_URL not tokenized | FIXED | tokenizedBoardURL |
| 3 | 1 | WARNING | engine/boardauth.js | different-port provisioning race | FIXED | atomic link() adopt |
| 4 | 1 | WARNING | native-app/main.swift | path duplication | DEFERRED | consistent w/ port dup |
| 5 | 1 | WARNING | server.js | direct-URL 403 UX | DEFERRED | frontend graceful (verified) |
| 6 | 2 | WARNING | native-app/main.swift | AGENT_WORKFORCE_DATA divergence | FIXED | consult override |
| 7 | 3 | BLOCKER | install/setup.sh | dashboard-open not tokenized | FIXED | _board_url token |
| 8 | 3 | WARNING | server.js | report/reply from_pane residual | DEFERRED | framing corrected, kosmos#1968 |
| 9 | 3 | NIT->fix | native-app/main.swift | AGENT_WORKFORCE_HOME omitted | FIXED | honor it |
| 10 | 4 | WARNING | install/setup.sh | plist perms (644) | FIXED | umask 077 + chmod 600 |
| 11 | 4 | WARNING | engine/boardauth.js | session cookie friction | FIXED | Max-Age |
| 12 | 4 | WARNING | engine/boardauth.js | sandbox predicate as boundary | FIXED | explicit residual note |
| 13 | 4 | WARNING | server.js | report/reply needs a ticket | FIXED | kosmos#1968 filed |
| 14 | 6 | WARNING | engine/boardauth.js | rename recovery race + false docstring | FIXED | re-read + honest docstring |
| 15 | 6 | WARNING | install/kosmos,setup.sh | token on argv, ps side-channel | DEFERRED | documented, kosmos#1970 |
| 16 | 6j | BLOCKER | install/setup.sh | bare [ -x ] passes a directory | FIXED | [ -f ] && [ -x ] |

### NITs (non-blocking)
- ensureToken chmod-only-on-generate (iter 1) -> fixed; board_token node-per-call (iter 1) -> accepted; comment overclaim (iter 2) -> fixed; gateLog ?token= (iter 2) -> fixed; duplicate-header 403 (iter 4) -> fails closed, no action; empty-token deadlock (iter 5) -> fixed; plist umask (iter 5) -> fixed; dead finally-unlink (iter 6) -> harmless; EACCES/empty conflation (iter 7) -> no action; stale /api/health plan text (iter 7) -> fixed.

### Strengths (recurring across iterations)
- The boundary is complete and fails safe: all account data under /api/, guard and dispatch read the SAME pathname (no encoding bypass), no WebSocket/upgrade/SSE handler, static shell + /icons/* carry no account data.
- Fail-CLOSED throughout: provisioning error -> null token -> refuse everything; enforcement decided at the victim board's own boot from its own env.
- Zero test/browser-check churn is real, not a fail-open: enforcement off ONLY on the fully-sandboxed shape the partial-boot refusal guarantees is the sole non-enforcing bootable board; every board-booting test sets it.
- crypto.timingSafeEqual with a length guard; atomic link() provisioning that adopts the on-disk token; httpOnly SameSite=Strict cookie with the bootstrap token stripped from the URL; gate-log token redacted.
- Tests pin the dangerous answer (no token -> 403) with a working perturbation (enforcement off -> proceed) and drive the real HTTP dispatch over a socket.

### Delivery reminder
Kosmos deploy is Angel / Mona Lisa. This PR opens for review, not self-merged. The live two-account demo is deliberately not run here (one account on this machine; a deliberate demo is being routed to the operator). The native-app change is swiftc-typechecked, not runtime-tested.

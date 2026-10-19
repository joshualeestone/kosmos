---
method: challenge-loop
branch: remotemark-6595
diff_hash: 4741ea7cd1de836d30416e65406b098cfd128d5cf05d908f15c9cb36ce1b8fcf
timestamp: 2026-10-19T15:47:14Z
subdir_audit: passed
iterations: 7
converged: true
---

# Challenge-loop proof: remotemark-6595 (kosmos#6595, board half)

The board tells a request that came through Kosmos+ (any forwarding header present, even empty) and refuses
three actions from such a request with 403 remote_not_allowed. Seven blind iterations alternating Opus and
Sonnet. Rebased onto origin/main after iteration 7 (clean merge-tree; the 38 branch tests rerun, 38/38).

#### Iteration 1 (Opus)
- [WARNING] docblock said the tunnel sets x-forwarded-host on every request: FIXED (it is x-forwarded-for on every request).
- [WARNING] two readings of "came through Kosmos+" (isRemoteRequest, madeOnThisComputer): FIXED, one helper cameThroughForwarder.
- [WARNING] a remote session can ask a local agent to make the request: FIXED as a documented limit in the plan.
- [WARNING] POST /api/agent-token mints a credential another computer uses: FIXED, guarded.
- [WARNING] federation/invite and own-code unguarded: DEFERRED with reason (they admit another Kosmos to a project room, not a device here); listed in the plan's exclusions.
- [NIT] docblock placement; [NIT] Remove not shown open remotely: both FIXED.

#### Iteration 2 (Sonnet)
- [WARNING] madeOnThisComputer loosened for empty headers: FIXED (presence, even empty, as before).
- [WARNING] nothing pinned that: FIXED, tests.
- [WARNING] array-valued header case cannot occur: FIXED, removed.
- [WARNING] join/retry, join/recheck reachable: DEFERRED with reason (this computer's own attempt, no allow; also screen-only).
- [WARNING] "each guard shown red" claim not backed by the tests: FIXED, plan says it was the author's local run.

#### Iteration 3 (Opus)
- [WARNING] signin-register exclusion reason wrong: FIXED (it allows only this computer's own sign-in and the browser it opens with a secret the remote never sees).
- [WARNING] other remote routes not named: FIXED, each named with its reason.
- [WARNING] test header misstated tunnel behaviour: FIXED.
- [NIT] one sentence did not fit all routes: FIXED, per-route sentences. [NIT] line break: FIXED. [NIT] Allow button still enabled remotely: DEFERRED (UX follow-up). [NIT] kosmos-relay doc stale: DEFERRED, noted as a relay follow-up.

#### Iteration 4 (Sonnet)
- [WARNING] agent-token sentence has no page caller: FIXED, plan says so.
- [WARNING] tunnel premise stated as fact: FIXED, marked "per kosmos-relay, not checked from this repo" and listed first under Not covered.
- [WARNING] exclusion reasons overclaimed as all checked: FIXED, evidence level stated per reason.
- [NIT] "beside" pointer; [NIT] self-comparing assert: FIXED. [NIT] blank case only unit-tested: carried to iteration 5.

#### Iteration 5 (Opus)
- [WARNING] empty-header rule not measured over HTTP: FIXED, HTTP test with empty x-forwarded-for and Forwarded (Node keeps empty headers; red with the old non-empty rule).
- [WARNING] plan credited the branch with madeOnThisComputer's empty-header rule: FIXED (unchanged on main, now shared).
- [NIT] declaration order; [NIT] ALLOW_ROUTES name: FIXED.

#### Iteration 6 (Sonnet)
- [WARNING] agent-token and join/confirm go beyond card call 1: FIXED as a recorded decision in the plan ("Beyond call 1, on purpose", reversible), Splinter told.
- [WARNING] x3 restating limits the plan already discloses (mutation results local, exclusion evidence level, tunnel premise): DUPLICATE of iterations 2, 4 (already disclosed).
- [NIT] wrapping; [NIT] empty-header HTTP test covers one route: accepted (shared code).

#### Iteration 7 (Opus)
- [NIT] empty x-forwarded-host not sent over HTTP (unit-tested); [NIT] Allow button enabled remotely (UX follow-up).
- No BLOCKER, WARNING or CONVENTION. Converged.

### Final Ledger
- Iterations: 7. New actionable findings per iteration: 6, 5, 3, 3, 2, 2, 0.
- Deferred with reasons: federation routes, join/retry and recheck, the remote Allow button (UX), the kosmos-relay doc line.
- Residual risk: the guard rests on the tunnel inserting x-forwarded-for on every forwarded request (kosmos-relay proxy.rs);
  a remote path that sets no header reads as local. Owner Renet, re-checked when the relay's sessioniat-6595 lands.

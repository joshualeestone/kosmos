---
pre_challenge: true
method: challenge-loop
branch: remote-agent-bind-1112
diff_hash: db84a4b125f465c5f25eb7bbdeba56bc770c946e3a46f73a11023b3f49c2a569
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T16:00:56Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 produced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs across all iterations)
**Fixed:** 8 | **Deferred:** 2 NITs (with reasoning) | **Asked:** 0

The change opens the board's network bind behind an explicit `KOSMOS_BIND_HOST`
opt-in and adds `remoteWriteGuard` (a socket-peer-keyed sibling to `crossSiteWrite`,
before every route) so a remote peer reaches only the token-authenticated agent
surface (`POST /api/report`, `POST /api/reply`); every dangerous local write,
above all `POST /api/agents`, stays loopback-only always. Plus a loopback-only
`POST /api/agent-token` issuance route. Validation: full suite `bash tools/run-tests.sh`
3529/3529 green (the canonical validation-log helper misdetects this repo's stack as
generic TypeScript/pnpm and looks for a nonexistent `typecheck` script; the repo's
real runner is run-tests.sh, run green each iteration).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] server.js — opening the bind needs a SECOND opt-in the plan/docs did not
  name: `pathOf`'s DNS-rebind Host check 400s any non-loopback `Host` BEFORE the guard
  runs, so a remote agent (`Host: <mac-ip>`) is refused unless the operator also sets
  `AGENT_WORKFORCE_ALLOWED_HOSTS`. Fails closed (no hole), but the feature was not
  demonstrated end-to-end and the requirement was undocumented. --> FIXED (1c3d884a):
  documented the two-part opt-in in the `bindHost()` docblock + plan, and added an
  HTTP-path test asserting a declared Host reaches a route while an undeclared
  non-loopback Host is 400'd (the layer the pure-function guard tests cannot see).
- [NIT] server.js — `/api/agent-token` returned 200 {issued:false} on mint failure,
  inconsistent with the sibling 400. --> FIXED (1c3d884a) then refined in iter 2.
- [NIT] server.js — timing oracle (wrong-route returns before disk I/O, bad-token after)
  --> DEFERRED: the allowlist is public in source, so no secret leaks; immaterial.
- [NIT] server.js — LOOPBACK_PEERS covers only canonical forms, not all of 127/8
  --> addressed in iter 2 with a deliberate-narrowing comment (fails closed).

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Duplicates confirmed resolved:** the iter-1 Host finding (not re-raised).
- [WARNING] server.js:5083 — my own iter-1 fix over-corrected: an all-punctuation name
  ("!!!") survives trim but reduces to empty under `safeKey`, so `mint` returns ok:false
  for a CLIENT error that the 500 then reported as a server fault. --> FIXED (f20d8ec7):
  validate keyability up front (`safeKey` throws) --> 400; reserve 500 for a genuine
  post-check write failure. Added a test asserting the unkeyable-name 400.
- [NIT] server.js — LOOPBACK_PEERS narrowing --> FIXED (f20d8ec7): comment that the
  canonical-forms-only narrowing is deliberate and fails closed.
- [NIT] plan:1 — plan title used an em dash (Josh's one style rule; code was clean)
  --> FIXED (f20d8ec7): swept all em dashes from the plan file.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings; six STRENGTHs confirmed every arm of the
security property (socket-peer classification, IPv6/`::ffff:` forms, Host-spoof defense
via the pre-guard socket check, allowlist exactness, oracle-freedom, the loopback
regression path, issuance status codes).
- [NIT] plan — described the guard as `remoteWriteGuard(req)`; it is `(req, pathname)`
  --> FIXED (3d582be0).
- [NIT] test — the loopback-only claim for `/api/agent-token` was derived, not asserted
  --> FIXED (3d582be0): added an explicit remote-peer-to-`/api/agent-token` 403 arm.
- [NIT] server.js — an open bind lets an unauthenticated remote peer force `resolveName`'s
  per-request fs scan --> DEFERRED (documented in the guard): inherent to validating a
  token, bounded by agent count, no worse than existing loopback per-request work;
  rate-limiting is a separate, larger change.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | server.js (bindHost/pathOf) | second opt-in (ALLOWED_HOSTS) undocumented, feature not demonstrated e2e | FIXED | 1c3d884a |
| 2 | 1 | NIT | server.js (/api/agent-token) | mint-failure status 200 | FIXED | 1c3d884a/f20d8ec7 |
| 3 | 1 | NIT | server.js (guard) | timing oracle on public allowlist | DEFERRED | immaterial (allowlist public) |
| 4 | 1 | NIT | server.js (LOOPBACK_PEERS) | canonical forms only | FIXED | f20d8ec7 (deliberate-narrowing comment) |
| 5 | 2 | WARNING | server.js:5083 | unkeyable name reported as 500 not 400 | FIXED | f20d8ec7 |
| 6 | 2 | NIT | plan:1 | em dash in title | FIXED | f20d8ec7 |
| 7 | 3 | NIT | plan | guard signature drift (req) vs (req,pathname) | FIXED | 3d582be0 |
| 8 | 3 | NIT | test | explicit remote->/api/agent-token 403 arm | FIXED | 3d582be0 |
| 9 | 3 | NIT | server.js (guard) | pre-auth resolveName fs scan on open bind | DEFERRED | inherent to token auth, bounded, documented |

### NITs (deferred, with reasoning)
- Timing oracle (iter 1): the allowlist is public in source, so latency cannot leak a secret.
- Pre-auth `resolveName` fs scan on an open bind (iter 3): inherent to validating a token,
  bounded by agent count, no worse than existing loopback per-request work; a rate-limit or
  token-set cache is a separate, larger change, and opening the bind is an explicit opt-in.

### Strengths (across all iterations)
- The guard keys on `req.socket.remoteAddress` (unforgeable), fails closed on an undefined
  peer, and runs before every route in the `crossSiteWrite` position. A `Host: 127.0.0.1`
  spoof past `pathOf` still hits the socket-peer guard: owning the network does not own the Mac.
- Oracle-free refusal: one identical sentence for no-token / bad-token / wrong-route, asserted.
- The bind is genuinely opt-in and leak-free: `KOSMOS_BIND_HOST` read only in `bindHost()`,
  default loopback, whitespace rejected; an un-opted-in board binds byte-identically to before.
- Tests use controls that can return the dangerous answer (loopback control reaches
  `/api/agents`; before/after store-emptiness on issuance; the allowlist is an exact-set
  assertion), and the guard's containment was proven red-capable by runtime perturbation.

Note: local `main` was 2 commits behind `origin/main` (the branch base), so the diff-hash
covers two already-merged commits. This is benign: the proof and the pre-challenge-gate hook
both compute against local `main`, so they agree, and GitHub diffs the PR cleanly against
`origin/main`. The shared main checkout was not touched (it holds another agent's uncommitted work).

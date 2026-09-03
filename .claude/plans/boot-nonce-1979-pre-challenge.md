---
pre_challenge: true
method: challenge-loop
branch: boot-nonce-1979
diff_hash: 85dbc89045ffc1568b65e7acb1b30e3d38e65cf7eb51d85c3d4d3618e5b8225d
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T08:50:47Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER (FIXED) + 1 WARNING (FIXED) + 3 NITs (2 deferred, 1 precision-fixed) + 14 STRENGTHs
**Fixed:** 3 | **Deferred:** 2 | **Asked:** 0

Baseline + final gate: `bash tools/run-tests.sh` (node suite + test:shell) exit 0. No `web/` change, so the
#1720 browser-check gate is not triggered.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 1 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT (+ 4 STRENGTHs)
- [BLOCKER] install/setup.sh -- the nonce-mint `curl` substitution ran under `set -euo pipefail`
  UNGUARDED, so a curl connection failure (exit 7) or timeout (exit 28) would ABORT the fresh install
  (the documented plain-URL fallback only covered HTTP-error failures where curl exits 0). --> FIXED
  (commit 4934a9a7: `... || true` on the substitution, matching cmd_open; verified the pattern survives
  a curl failure and falls back to the plain URL, reaching the rest of the installer).
- [NIT] non-enforcing board `/api/board-nonce` mint flood --> DEFERRED (bounded by sweep-on-mint + TTL,
  nonces inert on a non-enforcing board, local-only).
- [NIT] `?boot=<garbage>&token=<valid>` leaves `boot=garbage` in the 302 location --> DEFERRED (cosmetic;
  the garbage boot carries no secret and the next request has the cookie, no loop).

#### Iteration 2
**New:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 1 NIT (+ 5 STRENGTHs)
- [WARNING] the residual was framed only as "useless once redeemed and after ~2 min" and never named the
  in-TTL redemption race: the nonce STILL rides argv (inherent to `open <url>`), so a cross-account
  `ps`-poller can race to redeem it before the victim's browser within the TTL. --> FIXED (commit
  5b05aab2: documented the residual honestly in the boardauth.js and install/kosmos docblocks and the
  plan -- bounded (~2 min), single-use, and a lost race is DETECTABLE, but NOT "zero cross-account risk").
- [NIT] the setup.sh inline mint has no test (inherently hard in a 3800-line installer; shell-safety
  verified by hand) --> DEFERRED.

#### Iteration 3 (converged)
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT (+ 5 STRENGTHs)
**Converged** -- no actionable findings.
- [NIT] the residual note said a race-winner gets "an equivalent board cookie"; precisely the redeem 302
  sets `kosmos_board=<durable-token>`, so the winner recovers the DURABLE TOKEN itself. --> FIXED (commit:
  precision in the boardauth.js docblock + plan -- winning the race is as good as the old leak, but the
  attacker must now win a bounded single-use race instead of reading the token off argv at leisure).
- [NIT] non-enforcing mint flood (repeat of iter 1) --> DEFERRED (negligible/inert/local).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | install/setup.sh | unguarded mint curl aborts the install under set -e | FIXED | 4934a9a7 |
| 2 | 1 | NIT | server.js | non-enforcing mint flood | DEFERRED | bounded/inert/local |
| 3 | 1 | NIT | boardauth.js | garbage boot lingers in the 302 | DEFERRED | cosmetic, no secret |
| 4 | 2 | WARNING | boardauth.js/kosmos/plan | in-TTL redemption race undocumented | FIXED | 5b05aab2 |
| 5 | 2 | NIT | install/setup.sh | inline mint untested | DEFERRED | inherently hard; verified by hand |
| 6 | 3 | NIT | boardauth.js/plan | "equivalent cookie" understates: it carries the durable token | FIXED | precision commit |

### Outstanding questions (ASKED)
None.

### Strengths (across all iterations)
- The durable board token is fully off argv on all four paths (cmd_open happy + fallback, setup.sh
  happy + fallback): it reaches only shell builtins or `kosmos_curl`/a mode-600 header file, never an
  external command's argv. No live `?token=` caller remains; the CLI test asserts the token is absent
  from the opener argv by value.
- The mint gate is layered and unbypassable: loopback-only (remoteWriteGuard) + board-token sensitive
  gate; a cross-account loopback or network peer without the mode-600 token gets 403. The redeem path
  is loopback-only too.
- Single-use/TTL/replay is sound: `redeemNonce` burns before the expiry check, so an expired/used nonce
  cannot resurrect; Node's single-threaded loop makes concurrent same-nonce redeems mutually exclusive;
  `mintNonce` sweeps expired entries (bounded map).
- Fail-closed null-token is unreachable through the new path: no nonce is mintable while the token is
  null (mint 403s), so `cookieHeader(null)` never runs.
- `set -euo pipefail` safety is complete in the new setup.sh block after the fix; cmd_open guards its
  mint the same way.
- Tests use controls that return the dangerous answer (mint-without-token 403; burned nonce not-302;
  opener never gets the token by value; mint-fail falls back to plain, never `?token=`); the residual is
  documented honestly rather than overclaimed as "closed".

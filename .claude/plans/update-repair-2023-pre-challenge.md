---
pre_challenge: true
method: challenge-loop
branch: update-repair-2023
diff_hash: 4d9751133190505a4332b2a426dd58b90d14dc919c70530587dfe1d60c95d993
subdir_audit: passed
timestamp: 2026-09-03T15:20:53Z
iterations: 4
converged: true
---

# Challenge-loop proof: update-repair-2023 (kosmos#2023)

Fleet-wide board-auth outage. 0.6.25 shipped board-token enforcement; every
protected `/api/*` read now needs the httpOnly board cookie, set only by a browser
open with `?boot=<nonce>`. `install/setup.sh` opened the browser on a FRESH install
but not on an UPDATE, so auto-updated Macs that open their board from a bookmark get
a cookie-less page that 403s everything. The fix makes an enforcing UPDATE mint a
nonce and open the owner's browser once, marker-gated by `store.ROOT/.reauth-seeded`.

Diff under review: `install/setup.sh` (repair-open gate + open-success-gated seed) and
`.claude/plans/update-repair-2023.md`. No `server.js`/engine change (mechanism "b",
the in-app self-open, was DROPPED as a durable-token disclosure - see the plan).

## Convergence

Reached zero NEW defects in the diff. The final iteration's two findings both
resolved without a diff change: one to a pre-existing gap outside the diff (filed
#2033), one to a judged-benign non-correctness deferral. Verified `sh -n` and
`bash -n` parse-clean at every iteration.

## Ledger (per iteration)

| Iter | Category | File:Line | Finding | Status |
|---|---|---|---|---|
| 1 | WARNING | setup.sh seed | Marker seeded on mint-FAILURE (plain URL, no ?boot) -> machine marked done while board stays 403 | FIXED: seed gated on `_minted_nonce=yes` (commit 438c66c7) |
| 2 | WARNING | setup.sh:3864-3883 | Marker seeded on open-FAILURE (OPEN_CMD present but non-zero; `\|\| note` branch) -> permanent 403, no retry | FIXED: restructured opens to `if cmd; then _opened=yes; else note; fi`; seed gated on `_minted_nonce=yes` AND `_opened=yes` (commit e6cdaef4) |
| 2 | STRENGTH | setup.sh | Mint-failure retry semantics correct; errexit discipline consistent; `_open_gate`/`_seed_after_open` split correct | - |
| 3 | WARNING | setup.sh:3864-3868 | Marker written on open DISPATCH, not nonce REDEMPTION; the "dispatched but never navigated before 2-min TTL" residual is likelier on unattended updates | DEFERRED to #2030 (engine/auth-surface change; (a) is monotonic over the outage regardless, `kosmos open` is the recourse) |
| 3 | CONVENTION | setup.sh:3768-3771 | #1946 comment "no second copy of the path formula" made stale by the gate's own ROOT read | FIXED: comment reworded to the real invariant (no hardcoded path drift; identical node formula) (commit 7f153c3d) |
| 3 | STRENGTH | setup.sh:3739-3903 | errexit/set -u safety on every added line; POSIX-clean; no em dashes; no new attacker primitive | - |
| 4 | WARNING | setup.sh:3760-3761 | KOSMOS_INSTALL_PAGE=1 takes the shortcut (no mint/open); asked to confirm the flag is never set on auto-update | RESOLVED: confirmed via engine/update.js:511 that auto-update spawns `curl\|sh setup.sh` with the flag UNSET, so the repair fires for the outage population. The install-page path (installing.html:365 links to a bare board URL) is a pre-existing gap OUTSIDE this diff, filed #2033. Not a defect in the diff. |
| 4 | CONVENTION | setup.sh:3739-3743 | Bundled-node ROOT resolution now runs unconditionally (incl. sandbox/harness runs gated out later) | DEFERRED: setup.sh is once-per-install (not a hot path); `require(store).ROOT` is side-effect-free (the pre-existing 3778 read already assumes it); spawn only when bundled node exists; `_awroot_r` is structurally required before the gate (computes `_open_gate`/`_repair_seed`). Not a correctness issue. |
| 4 | STRENGTH | setup.sh:3902-3905 | Seed written iff nonce minted AND open succeeded; both failure modes leave it unwritten -> retries. One-time + enforcing-only gating sound. Comment accuracy verified. | - |

## Iteration findings (verbatim markers)

#### Iteration 1
- [WARNING] install/setup.sh (seed) -- marker seeded on mint-FAILURE (plain URL, no ?boot): a mint failure marks the machine done while its board stays 403. FIXED: seed gated on `_minted_nonce=yes` (438c66c7).

#### Iteration 2
- [WARNING] install/setup.sh:3864-3883 -- marker seeded on open-FAILURE (OPEN_CMD present but returns non-zero; the `|| note` branch fired) yet `_minted_nonce` still yes -> permanent 403, no retry. FIXED: opens restructured to `if cmd; then _opened=yes; else note; fi`; seed now requires `_minted_nonce=yes` AND `_opened=yes` (e6cdaef4).
- [STRENGTH] mint-failure retry semantics correct; errexit discipline consistent; `_open_gate`/`_seed_after_open` split correct.

#### Iteration 3
- [WARNING] install/setup.sh:3864-3868 -- marker written on open DISPATCH, not nonce REDEMPTION; the "dispatched but never navigated before the 2-min TTL" residual is likelier on unattended updates. DEFERRED to #2030 (engine/auth-surface; (a) is monotonic over the outage regardless, `kosmos open` is the recourse).
- [CONVENTION] install/setup.sh:3768-3771 -- #1946 comment "no second copy of the path formula" made stale by the gate's own ROOT read. FIXED: reworded to the real invariant (7f153c3d).
- [STRENGTH] errexit/set -u safety on every added line; POSIX-clean; no em dashes; no new attacker primitive.

#### Iteration 4 (final, converged)
- [WARNING] install/setup.sh:3760-3761 -- KOSMOS_INSTALL_PAGE=1 takes the shortcut (no mint/open); confirm the flag is never set on auto-update. RESOLVED: engine/update.js:511 shows auto-update spawns `curl|sh setup.sh` with the flag UNSET, so the repair fires for the outage population. The install-page path (installing.html:365 links to a bare board URL) is a pre-existing gap OUTSIDE this diff, filed #2033. Not a defect in the diff.
- [CONVENTION] install/setup.sh:3739-3743 -- bundled-node ROOT resolution now runs unconditionally. DEFERRED: setup.sh is once-per-install (not a hot path); `require(store).ROOT` is side-effect-free (the pre-existing 3778 read already assumes it); spawn only when bundled node exists; `_awroot_r` is structurally required before the gate. Not a correctness issue.
- [STRENGTH] install/setup.sh:3902-3905 -- seed written iff nonce minted AND open succeeded; both failure modes leave it unwritten -> retries. One-time + enforcing-only gating sound; comment accuracy verified.

### Final Ledger

No open BLOCKER/WARNING/CONVENTION in the diff. All WARNINGs fixed or resolved; both CONVENTIONs fixed or deferred with a code-read judgment; two follow-ups filed (#2030, #2033). Converged after 4 iterations.

## The dropped mechanism (b), recorded so it is not re-attempted

A token-exempt `POST /api/self-open` was in the original design. The loop found it a
durable-token disclosure: a non-browser `curl` forges its Origin past `crossSiteWrite`
to trigger the mint on demand, `ps -ww`-grabs the nonce off `open`'s argv (#1979's
threat model), and wins the redeem race for the durable board token = full `/api/*`
incl. code exec. Not fixable smaller (a reconnect must prove ownership = needs the
token a no-cookie page lacks). Baron Draxum (auth owner) independently verified and
agreed to drop it. Safe reconnect = CLI `kosmos open` (holds the token).

## Follow-ups filed

- #2030 - seed the marker on nonce REDEMPTION not dispatch (self-heals the cold-browser residual)
- #2033 - pkg install page links to a bare board URL (manual .pkg install 403s under enforcement)
- #2028 - the skipped-make_app / stale .app follow-up (split out earlier)

---
pre_challenge: true
method: challenge-loop
branch: makeapp-skip-2028
diff_hash: 1fad89feddc103e1667a59090374c4a8ec75714557bf48fe42a2fd8d525bf7b4
subdir_audit: passed
timestamp: 2026-09-03T15:49:14Z
iterations: 2
converged: true
---

# Challenge-loop proof: makeapp-skip-2028 (kosmos#2028)

Makes a skipped/failed native-app-bundle write visible: a greppable install-log
marker on every run, plus an operator note on an update that did not rewrite the
bundle, routing to the browser / `kosmos open` (never "relaunch the app", per #2023).

Diff under review: `install/setup.sh` (additive block after the app-icon reporting
chain), `tools/test-app-bundle-status.sh` (extraction-based unit test), `package.json`
(test:shell wiring), `.claude/plans/makeapp-skip-2028.md`. No `web/` change, no node
engine change.

## Convergence

Converged after 2 iterations. Iteration 1 found one CONVENTION (deferred with a
code-read judgment); iteration 2 found zero findings, so the loop converged. Verified
`sh -n` + `bash -n` clean and the test 18/18 at every iteration (under sh, bash, and
system bash 3.2.57).

## Iteration findings (verbatim markers)

#### Iteration 1
- [CONVENTION] install/setup.sh (the marker) -- the marker appends directly to `$LOG`, bypassing the async tee (awk at ~1013) that other stdout drains through, so it may appear positionally out of order relative to draining narration lines. DEFERRED: not a defect (the reviewer's own words). The marker is a single atomic (< PIPE_BUF) printf carrying all state inline and self-prefixed `[$$]`, so diagnosis is by `grep app-bundle:`, never by position; routing it through the fifo would give it a double `[id]` prefix and improve nothing. Consistent with the log's documented interleave tolerance.
- [STRENGTH] errexit/set -u safety: every bare-referenced var provably set before the block (LOG:448, APP_MADE:2970, APP_SKIP_ICON:291, FRESH_INSTALL:2216), the rest `${x:-}`-defaulted; `{ printf ...; } 2>/dev/null || true` correctly catches the shell's own redirect-open failure.
- [STRENGTH] gate correctness: APP_MADE=yes set only in the two bundle-write successes (2994, 3034); `APP_MADE != yes` on an update is exactly "not rewritten"; the note never fires on a fresh install.
- [STRENGTH] placement/reachability: block at column 0 after the chain's terminal fi (3185), runs in all four terminal states.
- [STRENGTH] the test: real shipped bytes via awk extraction, anchor-drift guard fails loudly, negative control proves chk can fail, every assertion non-vacuous, 18/18.
- [STRENGTH] POSIX-clean, no em dashes in the operator info lines, wired into test:shell.

#### Iteration 2 (converged)
- [BLOCKER] None.
- [WARNING] None.
- [CONVENTION] None. The extraction-based test technique matches the existing tools/test-install.sh approach; the block/comment style is consistent with the surrounding app-icon code. (The iteration-1 append-ordering note was not re-raised; it dedups against the iteration-1 deferral.)
- [STRENGTH] Independently re-verified: reachability, set -u safety (an unbound var under set -u is NOT rescued by `|| true`, so the always-set guarantee is load-bearing and holds), the errexit guard, gate correctness, the operator-note routing, the test's non-vacuous errexit arm, and the package.json wiring + 100755 mode.

### Final Ledger

No open BLOCKER/WARNING/CONVENTION. The one CONVENTION (iteration 1) was deferred with a
code-read judgment (accepted append-ordering tradeoff, grep-based diagnosis unaffected)
and not re-raised in iteration 2. Converged.

## Scope recorded

- #2028 part 1 (which arm fired on Josh's machine) needs his live machine state, which is
  not ours; the marker makes that answerable from the log going forward without asking.
- #2028 part 3 (whether the native app should refuse a board it cannot authenticate to)
  is an app/frontend change, out of this setup.sh lane; not built here.

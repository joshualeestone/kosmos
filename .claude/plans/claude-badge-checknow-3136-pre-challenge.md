---
method: challenge-loop
branch: claude-badge-checknow-3136
diff_hash: 13955fcbfb5cb2b7da15088134bc258b413403893b747be641ba384fe633a480
timestamp: 2026-09-16T17:20:36Z
iterations: 2
converged: true
---

# Challenge-loop proof: claude-badge-checknow-3136

Kosmos #3136: the Claude account badge never greens after "Check now" for the DEFAULT
account. Reproduced server-side on the served 0.6.70 board (a labeled account greens
live; the default stays neutral because its check-now probe returns UNKNOWN in ~4-5s).
Root cause: the check-now handler probed the default with CLAUDE_CONFIG_DIR DELETED,
relying on `claude -p`'s ambient default resolution, which fails in the board's launchd
process (no ambient shell env). Fix: pass the default's resolved acct.dir explicitly --
the same explicit-resolution pattern as the merged #3113 (a11ystatus tmuxGrant), a
different resolver (launchd-missing-ambient-env class, #3189). Two blind iterations,
opus then sonnet.

#### Iteration 1 (opus)
[STRENGTH] Correctness confirmed: `probeDir = acct.dir` for the default is sound and
robust -- accounts.js builds the default row as `<homeDir>/.claude` (homeDir =
AGENT_WORKFORCE_HOME || os.homedir(), and os.homedir() falls back to the passwd db when
HOME is unset), so acct.dir resolves correctly even in the launchd env where claude -p's
own ambient HOME-based resolution fails. Equivalent in a normal shell, strictly more
correct under launchd/sandbox; the default's acct.dir is always constructed (no absent-dir
case the old null handled).
[STRENGTH] Scope clean: the create gate (create.js) still uses `acct.isDefault ? null :
acct.dir` -- untouched; binPaths (shared with agent-creation, #3075 item 5) not in the
diff; labeled-account behavior unchanged; the new trailing `opts` param is optional so no
caller breaks and the diag is inert for the create gate.
[WARNING] server.js: the pre-existing "probe scoped EXACTLY... passing the default's dir
would diverge... under a sandbox HOME point the probe at the wrong config" comment was
left directly above the new fix, contradicting both the new comment and the code (its
sandbox-HOME claim is backwards). FIXED (ec5b90bab): deleted the stale paragraph.
[CONVENTION] server.js/create.js: stale "DRAFT / align to Angel's #3113 helper when it
lands" markers + a temporary diag with no tracking. FIXED (ec5b90bab): #3113 has landed,
so the markers now read "aligned with #3113 (merged), no shared helper (different
resolver)"; the diag is the routed verify instrument, stripped in a #3136 follow-up once
6.71 shows the default green.
[CONVENTION low] the diag dumps up to 400 chars of probe stdout+stderr to console.error
-- server-side log only (HTTP response is just {state}), reached only on the
unrunnable/config-not-found path (after capacity + dead-auth returns), claude -p error
text does not echo the OAuth token. Kept as the intentional, temporary verify instrument.

#### Iteration 2 (sonnet) -- CONVERGED
Clean: no BLOCKER, no WARNING. Correctness re-confirmed (acct.dir IS <homeDir>/.claude,
env-resolved). Scope re-confirmed by RUNNING the create-gate suites
(create.claude-probe-1916.test.js + create.account-connectable-1903.test.js, 21/21 pass,
which explicitly assert the create gate checks the default with NO configDir -- so that
path is untouched by content, not just by hunk-count); binPaths not touched. opts.diag
inert for the create gate (verified by the passing create suite), no user surface, low
residual leak risk, temporary. No stale comments remain in the changed regions (adjacent
`isDefault ? null : acct.dir` at server.js:7284/9062 are the agent-launch plist path, a
distinct code path, non-contradicting). Test verified the HARD way: reverting probeDir to
the old null makes the re-anchored `#3136 ROUTE` test fail ("expected .../.claude, got
null"), proving it catches a regression to the pre-fix behavior; sibling ROUTE tests
coherent. One CONVENTION-level note (the `probeDir = acct.dir` alias could inline) --
explicitly "not worth blocking... arguably aids readability", left as-is.

### Final Ledger
- [BLOCKER] none.
- [WARNING] one (iter1: stale contradicting comment) -> FIXED (ec5b90bab).
- [CONVENTION] DRAFT markers + diag tracking (iter1) -> FIXED; the diag-dump note and the
  probeDir-alias note are accepted as-is (intentional-temporary; readability).
- [STRENGTH] the re-anchored `#3136 ROUTE` test is the more important half: the OLD test
  used a fake probe that IGNORED configDir, so it asserted the buggy null-scoping and could
  never return the dangerous answer -- it would have stayed green through the real launchd
  failure forever. The new test asserts the resolved-dir contract and is negative-control
  verified.

Verify: badge-observed + observed + create-gate suites green. A fake probe cannot
reproduce the launchd-env failure (it ignores configDir), so units assert the CONTRACT;
the real default-account green is verified on the 6.71 board-as-launchd deploy (the shipped
scoped diag is the instrument), routed like #3113/#3191's fresh-Mac verify. NOT auth-surface
(#874): normal review, not Pete-gated.

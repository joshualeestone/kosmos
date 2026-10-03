# #5084: the promote experience gate says which version it checked

## The call
The gate itself (tools/staging-experience-check.sh) reads the board's running version with the same off-argv token
header it already builds, from `POST /api/update/check` (`running` is in every answer, even when its network check
fails). promote-channel passes `KOSMOS_GATE_EXPECT_VERSION=$V`. A board on another version, or one whose version cannot
be read, is cannot-tell (exit 2), which already means HOLD, forceable only after a hand check; the sentence says which
version the board runs. A pass prints "USABLE on <version>" and promote's line says the gate checked a board running $V.
The agent-spawn gate runs on the same board, so after a forced cannot-tell its pass line carries a note that it is not
a check of $V.

Rejected: reading the version in promote-channel itself (it would duplicate the gate's store-root and token logic,
which is already careful about argv); refusing outright (exit 1) on a mismatch (a stale board is not a broken build:
hold, as for any cannot-tell); `/api/health` (no version, by design: it is answered before the token gate).

Weakest premise: that POST /api/update/check has no side effect worth worrying about from a gate. It runs the update
check the board's own poll runs (a read of the release pointer); it does not install. If it ever started an install,
this gate would need another source.

## Measured (20:5x CDT)
- test-staging-experience-check.sh: 4 new arms against a fake enforcing board (node, loopback): previous release ->
  exit 2 naming both versions; unreadable version -> exit 2; matching -> exit 0 "USABLE on 0.7.19"; no expectation ->
  exit 0 as before. Plus the two old arms. All pass.
- test-staging-channel-2036.sh: promote hands the gate gate-expect:$V; the pass line names it; a normal pass carries no
  note; a forced cannot-tell qualifies the agent-spawn pass. 61 checks, ALL PASS.
- Mutants, each red by its own assertion: no version comparison; version never read; promote not passing the version;
  the note never printed. (The old pass sentence is pinned by the "names the version" assertion; reasoned, not run.)
- Both test files are in package.json test:shell.

## Review
- Round 1: PENDING.

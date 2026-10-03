# #5084: the promote experience gate says which version it checked

## The call
The gate itself (tools/staging-experience-check.sh) reads the board's running version with the same off-argv token
header it already builds, from a new read-only `GET /api/version` ({running}, a constant). [CORRECTED round 1: the
first cut read it from `POST /api/update/check`, which can START an install; see Review.] promote-channel passes `KOSMOS_GATE_EXPECT_VERSION=$V`. A board on another version, or one whose version cannot
be read, is cannot-tell (exit 2), which already means HOLD, forceable only after a hand check; the sentence says which
version the board runs. A pass prints "USABLE on <version>" and promote's line says the gate checked a board running $V.
The agent-spawn gate runs on the same board, so after a forced cannot-tell its pass line carries a note that it is not
a check of $V.

Rejected: reading the version in promote-channel itself (it would duplicate the gate's store-root and token logic,
which is already careful about argv); refusing outright (exit 1) on a mismatch (a stale board is not a broken build:
hold, as for any cannot-tell); `/api/health` (no version, by design: it is answered before the token gate).

Weakest premise [CORRECTED round 1]: I wrote that POST /api/update/check "does not install". It does
(checkNow -> refresh -> maybeAutoInstall, with auto-update on by default), measured by the reviewer. Now: a board too
old to have GET /api/version reads as "cannot read", so it HOLDS; the candidate itself carries the route.

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
- Round 1 (opus, blind): 1 BLOCKER, 2 SHOULD-FIX, 4 NIT, all taken (21:2x). BLOCKER (measured with update.js's own
  seams): the version read via POST /api/update/check can start an install, so a gate run could restart the board under
  test (and a hand run a real user's board). New GET /api/version, read-only; server.version-5084.test.js pins it: with a
  newer build published, an installed copy and auto-update on, GET runs the installer 0 times and the control (POST
  /api/update/check) does run it. The fake board now records any POST /api/update/check, and the test fails if the gate
  sends one. SF1: promote's HOLD line said "no fresh enforcing board" for a version mismatch too; now it points at the
  gate's own reason. SF2: "PREVIOUS release" was false for a board AHEAD of the candidate; now "another release". NITs:
  node parses the version (not a sed over the line); the fake's port is asserted non-empty, so it can never fall through
  to a real board on 16180; the forced exit-3 agent result also carries the not-a-check note; docs/staging-channel.md.
  Measured 21:2x, each red: the route calling checkNow (installs > 0); the gate posting to /api/update/check (the
  forbidden record). 2/2 server, gate test all arms, promote test ALL PASS.
- Round 2 (sonnet, blind): 0 BLOCKER, 0 SHOULD-FIX, 3 NIT. CONVERGED (21:22). Measured: server test 2/2 with its control
  armed and seams restored; the route inventory test (web.api-routes-3957) 29/29; the gate and promote tests. Reasoned:
  /api/version is behind the board token (in no pre-token exemption set); HEAD-safe; suffixed versions compare exactly.
  NITs not taken: no enforcing-board 403 arm for the route (the token gate covers every /api/ path by default; an
  exemption would be a deliberate edit); a "v"-prefixed version would read as unreadable (package versions carry none);
  a comment cites round 1.

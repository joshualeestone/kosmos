---
pre_challenge: true
method: challenge-loop
branch: whatsnew-7411
diff_hash: 8014715be9ff86ba0ba1c2f265e834682c17b7c48c1df612d2c4516e79d5deaf
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T12:30:24Z
iterations: 10
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (the 8-round loop, one blind round on the board-deploy fix the full validation forced, and one on the node fallback PR #7477's CI forced)
**Converged:** No. Round 8 found nothing actionable (the loop converged on that diff at the 8-round cap). The full
validation then went red on tools/test-board-deploy-manifest.sh, a real gap; the fix (ea6fdb52ca) got one blind round
(iteration 9), whose two WARNINGs were fixed or filed (a10af938e4, #7465) and not re-reviewed.
**Fixed:** every BLOCKER and WARNING of rounds 1 to 9, except one filed as its own card | **Asked:** 0

Provenance, stated plainly: iterations 1 to 8 ran in Baron's earlier session (10-27). Their ledger is reconstructed
from the commit messages that fixed each round (b498afc545 to 0e7b635652) and the session's handoff, not from the
session's own record, and their reviewer models were not recorded. Iteration 9 ran in this session.

Validation: PASSED on bdf4f1032d (rebased onto main after #7466; stack=typescript, hash 8014715be9ff, 25295 node tests, 0 failed). Earlier: PASSED on a10af938e4 (stack=typescript, hash db16a33bc46b, 25057 node tests, 0 failed). Two earlier full
runs on the branch are on record and explained: one failed on test-queued-heavy-4977, caused by an orphaned fixture of
Baron's own earlier run (a fresh checkout of the same commit passed; #7411 comment); one failed on three timing-bound
tests in files the branch does not touch that passed 317/317 alone under load, and on test-board-deploy-manifest.sh,
which was real and is fixed here.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (earlier session)
- [BLOCKER] the Windows CLI had no whats-new verb (verb parity) --> FIXED (b498afc545; both CLIs call releasenotes.render)
- [WARNING] a Linux build listed Mac-only notes --> FIXED (each build ships its own platform's notes)
- [WARNING] the default view printed everything on an x.y.0 and dropped notes on a skipped number --> FIXED (the newest version's own notes)
- [WARNING] the Mac builder did not check for node --> FIXED

#### Iteration 2
**Reviewer model:** unknown (earlier session)
- [WARNING] the plan did not say why a pending item at or below the build ships --> FIXED (c9b394aef0)
- [WARNING] the Linux and Windows builders did not check for node --> FIXED

#### Iteration 3
**Reviewer model:** unknown (earlier session)
- [WARNING] the global --help answered whats-new with the command list --> FIXED (c02b15b0d5)
- [WARNING] the Mac CLI's errors went to stdout --> FIXED (stderr)
- [WARNING] exit under a long answer could cut it off --> FIXED (exitCode)

#### Iteration 4
**Reviewer model:** unknown (earlier session)
- [WARNING] a notes file for another version was shown as this install's --> FIXED (52862aa15f, refused with a sentence; a matching control reads)

#### Iteration 5
**Reviewer model:** unknown (earlier session)
- [WARNING] a damaged notes entry crashed with a stack trace --> FIXED (b95c40818d)
- [CONVENTION] the tool's header and usage did not name the notes command or the restart field --> FIXED

#### Iteration 6
**Reviewer model:** unknown (earlier session)
- [WARNING] entries with a non-string line, an unknown restart or bad platforms were not refused --> FIXED (41386c96bf)
- [WARNING] notes into an unwritable folder crashed --> FIXED (a sentence, exit 2)

#### Iteration 7
**Reviewer model:** unknown (earlier session)
- [WARNING] the status filter was a denylist, so a status added later would ship --> FIXED (0e7b635652, allowlist shown/pending; a test proves an unknown status stays out)
- [CONVENTION] the plan falsely said the Mac builder had no node dependency --> FIXED (claim deleted)

#### Iteration 8
**Reviewer model:** unknown (earlier session)
**New findings:** none actionable. Converged at the 8-round cap.

#### Iteration 9 (after the full validation's real red, 03:4x CDT 10-28)
**Reviewer model:** opus
**Self-generated:** 0 (the fix commit ea6fdb52ca is not a loop fix commit)
- [WARNING] deploy/install-board.sh: the new notes step was untested (the manifest test compares paths only) --> FIXED (a10af938e4, engine/releasenotes.test.js pins the call; red when the output path changes, measured)
- [WARNING] tools/test-install-board-paths-2870.sh: its fixture cannot stage a board (stale since #6587) --> DEFERRED: predates this branch; filed as #7465
- [NIT] tools/whats-new-pool.js: restart sat inside the status list --> FIXED
- [NIT] deploy/install-board.sh: literal backslashes in a comment --> FIXED
- [NIT] a shared-number heading can name a version a platform never shipped --> DEFERRED: the text is accurate; heading wording is a later polish

### Final Ledger (iteration 9; 1 to 8 above, reconstructed)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 9 | WARNING | deploy/install-board.sh | BRANCH | notes step untested | FIXED | a10af938e4 |
| 2 | 9 | WARNING | tools/test-install-board-paths-2870.sh:40 | BRANCH | stale fixture | DEFERRED | #7465 |
| 3 | 9 | NIT | tools/whats-new-pool.js:12 | BRANCH | restart in the status list | FIXED | a10af938e4 |
| 4 | 9 | NIT | deploy/install-board.sh:68 | BRANCH | backslashes in a comment | FIXED | a10af938e4 |
| 5 | 9 | NIT | engine/releasenotes.js | BRANCH | shared-number heading | DEFERRED | text accurate |

### Strengths (iteration 9)
- The status filter is an allowlist and fails closed; a test checks the real pool against package.json.
- Both CLIs call the same render, so they cannot drift; errors go to stderr and long output is not cut off.
- readNotes refuses a notes file for another version, and a damaged entry is a sentence, each with a control.

#### Iteration 10 (after PR #7477's CI red, 06:1x CDT 10-28)
PR #7477's CI went red on tools/test-install-board-paths-2870.sh (main's version, from #7466, which requires the
fixture to stage): CI's Linux runner has no /opt/homebrew/bin/node, so the notes step failed staging. Fixed in
eebc09d04b (the board's node, else the one on PATH), reproduced red here with KOSMOS_BOARD_NODE pointing at a missing
file and green after.
**Reviewer model:** sonnet
- [WARNING] deploy/install-board.sh: nothing executed the notes step (the release-notes test reads text; the fixture stubs the tool) --> FIXED (bdf4f1032d: a test runs stage_app for real into a temp folder with no board node; an extra argument on the call reds only it, measured)
- [WARNING] a prerelease version would now stop staging --> DEFERRED: every Kosmos version is N.N.N (package.json, the cut)
- [WARNING] the PATH fallback is silent --> DEFERRED: the service-key step's fallback is silent the same way; a say line is a later polish
- [NIT] the manifest test does not pin release-notes.json --> DEFERRED: the new execution test checks the file itself
- [CONVENTION] the plan's test count was stale --> FIXED (20)

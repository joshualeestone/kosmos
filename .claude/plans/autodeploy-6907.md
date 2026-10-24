# autodeploy-6907: a publisher a test started must not hold the site deploy

Card: kosmos#6907 (claimed: icecreamkitty). Owner of site deploys: Ice Cream Kitty.

## Problem

`tools/site-autodeploy.sh` `publisher_running()` decided "a release cut, deploy or promote is running" by
matching command lines alone. On 2026-10-22 11:00 CDT a #6781 validation on Mortals ran
`tools/test-deploy-site-promote.sh`, which launches the real `tools/deploy-site.sh --promote` as a test
subject; the match held chaoskosmos-site#237 off the live site and the skip message claimed a cut.

## Decision

Keep the process-list match (deploy-site.sh and promote-channel.sh take no lock of their own, so a
lock-only check would miss a hand-run deploy), and add ancestry:

- the list becomes `ps -axo pid=,ppid=,command=`;
- a publisher match whose parent chain reaches a `tools/test-*.sh` command (same anchoring as the publisher
  pattern), or a node process running `--test` or a `*.test.js` file (the node suite spawns the real
  release.sh: tools.release-gate.test.js), is passed over; a plain node process is not a test, and neither
  is an ancestor whose own command also names a publisher (`bash -c 'tools/test-x.sh && tools/deploy-site.sh'`);
- a match passed over is logged with the test above it (a wrong exemption leaves a record);
- the skip message names the pid and command that held it.

Rejected: using release.sh's cut marker only (misses hand-run deploy-site/promote-channel); excluding by
path (validation worktrees have arbitrary names, and a real deploy can run from a worktree too).

## Fail-closed cases (all still hold the deploy)

- a line without pid/ppid (no ancestry known);
- a test subject whose harness died (ppid 1, no test above it);
- a real cut whose own gate runs a test of deploy-site.sh (the cut itself matches with no test above it);
- the matcher (awk) failing.

## Weakest premise

Every test that runs a publisher has a `tools/test-*.sh` ancestor or a node `--test` / `*.test.js`
ancestor. A test launched any other way still holds the deploy (the safe direction, a delay, as before).
The reverse risk: a REAL publisher started under a node test process would be passed over; nothing does
that today, since a cut starts release.sh from a shell and release.sh's own gate runs the node suite
beneath it, not above it.

A second premise, the one the whole card rests on: a test that runs a publisher runs it against fakes,
never the live site, so a tick may deploy beside it. Checked for the incident's test:
tools/test-deploy-site-promote.sh stubs `vercel` and `curl` on PATH and publishes into a temp LIVE dir. A
test that ran a publisher against the real site would be a defect in that test whatever this job did.

## Deferred

- The skip line prints up to 200 characters of the matched command into the log and the job output. The
  three publishers take a version or flags; deploy-site.sh reads the Vercel token from the environment.
  Kept, because the path is what tells a reader the holder was a test worktree.
  The passed-over line carries the same text plus the test's command, on the same reasoning.
- The passed-over line is written on both looks of a tick (before and after the mirror): two lines per
  tick while a test runs. Kept: a record per look is what shows the second look saw it too.

- Iteration 6 NITs, kept as they are: a `node ... --test` anywhere in a node command exempts (the
  missed-hold direction, named above); pid reuse inside one ps snapshot; the first 7b arm's middle hop is
  not itself publisher-named (the shellc and mixed arms cover the neighbours).

- Unchanged residual: the shell suite's syntax checks (`bash -n tools/release.sh`) run under `sh -c`
  from yarn, not a test-named ancestor, so they still hold a tick; they last milliseconds.

## Tests

`tools/test-site-autodeploy-5589.sh` section 7b: test-started (passes over), hand-run control (holds, named),
orphan (holds), cut running its tests (holds, named as the cut), node suite's release.sh (passes over),
release.sh under a plain node process (holds), a parent cycle (holds), failing matcher (holds). Mutants: removing
the ancestry exclusion reds the test-started arm; exempting every parented line reds the three hold arms.

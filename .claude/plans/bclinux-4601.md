# bclinux-4601: the per-PR browser-checks job runs on ubuntu-latest

Card: #4601 (the hosted macOS pool queues about an hour; the CI-starved merge rule exists because of it).
Decision and weakest premise: #4601 comment 5956923938 (PigeonPete, 11:45 CDT 2026-10-02).

## Why
Baron measured (on #4601) that the macOS pool is 96% busy with real work, so no workflow tuning helps.
The two levers are a bigger allowance (money, Josh's) or fewer macOS minutes per PR. browser-checks.yml is
30% of macOS minutes, and it runs only the DOM-state allowlist plus the checks the diff selects, never
paint or timing checks. Its macOS pin was a consistency choice, not a measured need. Linux and Windows
jobs start at once.

## Change
1. .github/workflows/browser-checks.yml, job `browser-checks`: runs-on ubuntu-latest; after provision-pw,
   `sudo <pinned playwright> install-deps chromium webkit`; tmux from apt (after an apt-get update).
2. tools/test-browser-checks-workflow.sh: the pins follow (runs-on ubuntu-latest; tmux from apt before
   the checks; system libraries installed after provisioning and before the checks).
   browser-checks-full.yml (nightly, full set) stays pinned to macos-latest.

## Not changed
- test.yml stays on macOS (about 40 tests fail on Linux for correct macOS-only reasons, recorded there).
- The cut's 3b and browser-checks-full.yml stay on macOS: the OS-family gate is where shipping is decided.
- No self-hosted runner (public repo; every fleet Mac holds agent credentials).

## Verification
- tools/test-browser-checks-workflow.sh green; a mutant putting macos-latest back fails it.
- The PR's own browser-checks run on ubuntu-latest (a pull_request uses the PR's workflow) must be green
  with the same checks running. Any check that cannot run on Linux is named on the PR and either fixed or
  the job goes back to macOS (the card's "what would change my mind").
- Rule for the full-set measurement (Splinter, 11:59, tightening my own condition): a check red ONLY on
  Linux is NOT added to KNOWN_RED by default; that would be weakening the check. Each one is listed on
  #4601 with its cause, and the job moves only if every one is a runner difference I can explain (font,
  WebKit port, a macOS path in a fixture), never a product bug the Mac happens to hide. "Linux-only"
  means red on the Linux run and green on the latest macOS nightly for the same check.

## Iterations
(filled in by the review loop)

### Iteration 1 (opus, blind): 0 blockers, 4 warnings. All taken.
1. Only the allowlisted checks would be measured on Linux. Fixed: the FULL set is measured once on ubuntu
   by dispatching browser-checks-full.yml on this branch with a temporary MEASUREMENT ONLY commit
   (run 37036328772); reverted before the PR, and the workflow test fails while it is in place.
2. False and stale macOS comments. Rewritten (what the job runs, a fourth way its green differs from 3b).
3. Linux WebKit is not Safari's. Named in the comment as a cost.
4. sudo ran the pinned playwright under the image's system node. Removed (install-deps elevates apt itself).
NITs taken: one apt-get update. Left: click-first-run.js's historical "macos-latest runner" wording.

### Iteration 2 (sonnet, blind): 0 blockers, 1 conditional warning, nits.
1. WARNING (conditional): the comment promising KNOWN_RED entries. Resolved by the measurement and
   Splinter's rule: Linux-only reds are explained on #4601 one by one, not added to KNOWN_RED, and KNOWN_RED
   only suppresses a SELECTED check, so an allowlisted Linux-only red would red every PR. The comment is
   rewritten with the results.
NITs taken: the pgrep claim is now "not verified on Linux"; the 2026-09-07 run is "on the macOS runner".

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

## Iterations
(filled in by the review loop)

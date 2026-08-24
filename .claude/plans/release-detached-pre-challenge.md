---
pre_challenge: true
method: challenge-loop
branch: release-detached
diff_hash: 584e50bc250e4850ef96b4f73467b6438967358ecabb6c4ee54e2cff9a941934
subdir_audit: passed
timestamp: 2026-08-24T19:05:31Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (bounded before the loop began, stated to the PM: two fixing rounds then a convergence pass; the convergence pass records and cards, it does not fix; anything past it is a follow-up card)
**Converged:** Yes (iteration 3 found zero BLOCKER, WARNING or CONVENTION)
**Total findings:** 5 BLOCKERs 0, WARNINGs 6, CONVENTIONs 0, NITs 12
**Fixed:** 6 WARNINGs + 6 NITs | **Recorded, not fixed:** the one-directional-comparator gap (#609, a different failure class than #597), three convergence NITs (#610), and one convergence NIT fixed because it made a comment I wrote in this PR true rather than false.

Validation (canonical helper: full suite + subdir audit) after every round and on the final commit: 1855 of 1855, exit 0; audit exit 0; tree clean. Beyond the suite (which runs against a fake tmux and scratch repos): the freeze was exercised on the REAL repo three times, each freezing HEAD, building the bundle inside the frozen worktree, and comparing the served/built bundle against the frozen tree, with a negative control (a tampered bin/kosmos caught, exit 1; a different sha's tree differing in the expected files). tools/test-release-detached.sh reproduces the race (a mid-release fast-forward pull of the scratch main checkout) and asserts the frozen tree does not move; it passes 0 failures.

### Per-Iteration Breakdown

#### Iteration 1 (fixing)
**New findings:** 0 BLOCKERs, 5 WARNINGs, 5 NITs
- [WARNING] release-freeze.sh: `2>&1 >&2` sent git's chatter INTO the captured path --> FIXED (4f09c04: plain >&2)
- [WARNING] release.sh 9b: compared only app/, so a stale bin/kosmos (install/kosmos) would pass --> FIXED (4f09c04: compare app + bin/kosmos, relocation map extended, test added)
- [WARNING] test: an empty BUILD led to root-anchored paths (mkdir /web, rm -rf /install) --> FIXED (4f09c04: exit before path arithmetic)
- [WARNING] test: depended on init.defaultBranch=main --> FIXED (4f09c04: --initial-branch=main)
- [WARNING] release.sh: a failed freeze AFTER worktree add left a phantom registration --> FIXED (4f09c04: release_freeze thaws its own worktree on a failed check)
- [NIT] SHA captured a dozen lines after the bump --> FIXED (4f09c04: captured at the clean check)
- [NIT] comment said steps 3-6 only; step 9 depends on the frozen tree too --> FIXED
- [NIT] grep the temp path literally (-qF) --> FIXED
- [NIT] add bash -n tools/release.sh to test:shell --> FIXED
- [NIT] plan Change 2 did not match the shipped form --> FIXED

#### Iteration 2 (fixing)
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] the comparator is one-directional (a file dropped from the build's hand-maintained list is not caught) --> RECORDED as #609: a different failure class than #597 (content drift, which IS caught), and the header is honest about the direction
- [NIT] 9b had no retry unlike step 9's 6-attempt loop --> FIXED (2a450f0: 9b retries six times)
- [NIT] "bump sha" wording slightly loose (SHA is HEAD carrying the bump) --> FIXED (2a450f0)

#### Iteration 3 (convergence, bounded)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
- [NIT] release.sh 9b failure message names one cause for three reasons --> RECORDED #610
- [NIT] trap is EXIT only, not INT TERM --> RECORDED #610
- [NIT] cmp does not check file mode --> RECORDED #610
- [NIT] build-kosmos-bundle.sh:99 bin/kosmos cp lacked the cross-reference its sibling had, while the lib comment claimed both cp's carry it --> FIXED (9af1980): a comment I wrote in this PR was false; making it true is not shipping a lie, not a new improvement

### STRENGTHs (across iterations)
- The invariant is verified end to end: SHA captured the instant the tree is clean, frozen via `worktree add --detach <sha>`, every downstream $REPO use resolves to the frozen tree, only step 10 reroutes to $MAIN_REPO (preserving restart-local-board's $0-gate, which a frozen-tree invocation would have silently skipped, reintroducing #360).
- The change hunts its own leak class: verify-served.sh's hardcoded default REPO would have re-read the shared checkout at step 9; the explicit REPO="$REPO" pass closes it, and the remaining paths between 2b and 10 were checked (Playwright from ~/work/pw-runtime, dependency-free app, only dist/ ignored, assets tracked).
- The comparator refuses vacuous passes (zero files, missing member) and the test proves the race moved the shared checkout before asserting the frozen tree did not (presence before absence), perturbing exactly one file per negative case.
- The bound held: iterations 1 and 2 found things about the change and its fixes; iteration 3 found no BLOCKER/WARNING/CONVENTION, and its NITs were recorded, with the single exception being a false comment made true rather than a new improvement.

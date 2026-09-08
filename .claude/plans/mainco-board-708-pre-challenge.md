---
pre_challenge: true
method: challenge-loop
branch: mainco-board-708
diff_hash: d6e06da4daf906530f09a066938a0a95902676ff02309a477152c6e9b1832d9c
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T14:39:18Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes, at iteration 10 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Total findings:** 49 (0 BLOCKERs, 21 WARNINGs, 3 CONVENTIONs, 25 NITs)
**Fixed:** 47 | **Deferred:** 2 | **Asked (awaiting user):** 0

**Reviewer models:** alternating opus / sonnet across all 10 iterations, so no single model's
blind spots could carry the convergence.

### What this change is

kosmos#708 is a class card about shared state on this Mac producing false test reds. Most of it was
already built and nobody had closed the card. Measured before writing any code: `run-tests.sh`
already records a live board beside a red, prints its cwd, and refuses the suite for a foreign
release claim. The gap was that it printed a bare path and left the reader to recognise it, while
the card names a board in the MAIN CHECKOUT as a separately contributing cause.

`board_origin_label` classifies that cwd: main checkout, linked worktree, or neither. It runs **no
subprocess**, does **not** search upward, and **declines** to classify `$HOME`, where the installed
board runs.

### The loop's own evidence for kosmos#120

This branch is not #120, but it produced #120's phenomenon repeatedly and measurably. The Origin
step merged in claude-setup#40 was run by hand against each iteration's findings (this machine's
**installed** skill predates that merge, so the deployed loop could not run it):

```
iter 1   0 of 3 SELF     the fail-safe: no loop fix commits existed yet
iter 2   2 of 4 SELF
iter 4   2 of 2 SELF     first pass finding NOTHING about the original branch
iter 5   3 of 4 SELF
iter 6   2 of 2 SELF
iter 7   3 of 3 SELF
iter 8   2 of 2 SELF
iter 9   4 of 4 SELF
```

**Ten claims written inside a fix, each false about the behaviour that same fix had just changed:**

```
 1  header said it keyed on "the git fact"        it keyed on a path shape
 2  FAIL-OPEN arm claimed to test run-tests.sh    it tested a hand-typed copy
 3  header said the revert closed the $HOME case  it closed only "under a repo"
 4  comment said lsof gives the same spelling     symlink + trailing slash defeat it
 5  label said ".git is not a link"               -d FOLLOWS symlinks; never measured
 6  comment cited "if/fi = 1/0" as measured       awk's terminator is INCLUSIVE
 7  arm named "set -u is not tripped"             ran in a child not inheriting -u
 8  plan said the subdirectory case was "fixed"   it was REVERTED
 9  plan called a subdirectory "the likely case"  the live board's cwd is $HOME
10  DISCRIMINATION comment overstated its need    a sibling arm already covered it
```

Not one was caught by rereading. All ten came from blind reviewers.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] tools/lib/board-origin.sh - a board in a SUBDIRECTORY fell through to the bare path, and the header's "keys on the git fact" claim was false --> FIXED (4cd6c348)
- [WARNING] tools/test-board-origin.sh - nothing tested the INTEGRATION; deleting the source line or the call left the suite green --> FIXED (4cd6c348)
- [WARNING] plan - "242 of 320 test files" was a ratio between two different sets --> FIXED (4cd6c348)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] the `git` call is unbounded --> DEFERRED, then resolved by removal at iteration 3
- [WARNING] plan's "Weakest premise" was wrong about the DIRECTION of both residuals --> FIXED (e0ab7df7)
- [CONVENTION] two em dashes in the plan, a hard fleet rule --> FIXED (e0ab7df7)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] `rev-parse` searches UPWARD: a board under ANY repo read as MAIN CHECKOUT; with a git-managed $HOME the INSTALLED board would be accused --> FIXED by REVERTING iteration 1's fix (22dd8a26)
- [WARNING] `GIT_WORK_TREE` made it describe a directory the board is not in --> FIXED (22dd8a26)
- [WARNING] the deferral's premise was false: `lsof -S` is self-bounded at 15s by default, so `git` was the only unbounded probe --> FIXED (22dd8a26)
- [WARNING] no arm pinned the `--show-prefix` rationale --> FIXED (22dd8a26)
- [WARNING] an integration arm matched a mere mention --> FIXED (22dd8a26)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] the FAIL-OPEN arm re-typed run-tests.sh's guard, asserting against its own private copy --> FIXED (055c328c)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 6 NITs
- [WARNING] the revert did NOT close the $HOME case: when $HOME IS the repo root the label still fired, and the INSTALLED board runs from $HOME --> FIXED (d4d5fc48)
- [CONVENTION] the header claimed the revert had closed it --> FIXED (d4d5fc48)
- [WARNING] an arm's NAME claimed the installed-board case its fixture never covered --> FIXED (d4d5fc48)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] the $HOME decline was a STRING compare, defeated by a symlinked $HOME and by a trailing slash --> FIXED with `-ef` (9a6c2091)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] the label said ".git is a directory rather than a link" but `-d` FOLLOWS symlinks --> FIXED (3947653b)
- [WARNING] the residual list read as exhaustive and omitted the symlinked-.git shape --> FIXED (3947653b)
- [CONVENTION] the plan cited the REVERTED implementation as the bare-repo mechanism --> FIXED (3947653b)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] the awk extraction was fenced only by a substring; a truncated block keeps that string and would execute the wrong bytes --> FIXED with structural if/else/fi counts (0bd021d5)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] the THIRD deletion path was uncovered: nothing asserted the computed value reaches the EMITTED line. Measured: change the emit line and the feature vanishes while all 32 arms stay green --> FIXED (331ced80)
- [WARNING] a comment cited if/fi = 1/0 as measured, which this awk range cannot produce --> FIXED (331ced80)
- [WARNING] the "set -u is not tripped" arm ran in a child that does not inherit `set -u`, so that half was vacuous --> FIXED (331ced80)
- [WARNING] the plan contradicted the shipped code about the subdirectory case --> FIXED (331ced80)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged.** The reviewer independently perturbed scratch copies to falsify the central claims (the `-ef` guard, the anchor coupling, the `bash -c` splicing, the sourcing order) and every one held. One NIT deduplicates against a deferral the code's own comment already records.

### Final Ledger (the findings that changed shipped behaviour)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | lib/board-origin.sh | BRANCH | subdirectory unclassified; header claim false | FIXED | 4cd6c348 |
| 2 | 1 | WARNING | test-board-origin.sh | BRANCH | integration untested | FIXED | 4cd6c348 |
| 3 | 1 | WARNING | plan | BRANCH | ratio between two different sets | FIXED | 4cd6c348 |
| 4 | 2 | WARNING | lib/board-origin.sh | SELF | unbounded git call | FIXED | 22dd8a26 (by removal) |
| 5 | 2 | WARNING | plan | BRANCH | weakest premise wrong in direction | FIXED | e0ab7df7 |
| 6 | 2 | CONVENTION | plan | BRANCH | em dashes | FIXED | e0ab7df7 |
| 7 | 3 | WARNING | lib/board-origin.sh | SELF | upward search accuses the installed board | FIXED | 22dd8a26 |
| 8 | 3 | WARNING | lib/board-origin.sh | SELF | GIT_WORK_TREE redirects the answer | FIXED | 22dd8a26 |
| 9 | 3 | WARNING | plan | SELF | deferral premise falsified by lsof -S | FIXED | 22dd8a26 |
| 10 | 4 | WARNING | test-board-origin.sh | SELF | fail-open arm tested a hand-typed copy | FIXED | 055c328c |
| 11 | 5 | WARNING | lib/board-origin.sh | SELF | $HOME as repo root still accused | FIXED | d4d5fc48 |
| 12 | 5 | CONVENTION | lib/board-origin.sh | SELF | header claimed the revert closed it | FIXED | d4d5fc48 |
| 13 | 6 | WARNING | lib/board-origin.sh | SELF | string compare defeated by spelling | FIXED | 9a6c2091 |
| 14 | 7 | WARNING | lib/board-origin.sh | SELF | label claimed to measure "link" | FIXED | 3947653b |
| 15 | 7 | CONVENTION | plan | SELF | cited the reverted implementation | FIXED | 3947653b |
| 16 | 8 | WARNING | test-board-origin.sh | SELF | substring-only extraction fence | FIXED | 0bd021d5 |
| 17 | 9 | WARNING | test-board-origin.sh | SELF | emit-line deletion path uncovered | FIXED | 331ced80 |
| 18 | 9 | WARNING | test-board-origin.sh | SELF | set -u arm vacuous in a child shell | FIXED | 331ced80 |
| 19 | 9 | WARNING | plan | SELF | contradicted the shipped code | FIXED | 331ced80 |

### Deferred, with reasoning

- **A subdirectory of a checkout is NOT classified**, and prints the bare path. The fix for it was
  built at iteration 1 and reverted at iteration 3 after three failure modes were measured. A label
  that stays silent beats one that can assert a violation that is not happening, and the #708
  incident was a board at a checkout root. Asserted by its own arm so it stays a decision.
- **The three INTEGRATION arms are unanchored substring matches.** A comment in `run-tests.sh`
  quoting the same fragment would satisfy them. The fragments are distinctive and the coupling is
  documented at both ends; anchoring on line numbers would be worse.

### Outstanding questions (ASKED, still unresolved)

None. No finding was routed to the user; every one was decided and recorded.

### NITs (non-blocking, carried forward)

- The `$HOME`-as-subdirectory residual bullet is worded ambiguously. Both readings were tested and
  both produce the documented safe outcome, so the claim is true but hard to parse.
- A path whose own text contains "worktree" makes the main-checkout label contain that word. Scoped
  in the header as a prose-only invariant and pinned by an arm.

### Validation record, including one red

```
after iter 1  PASSED     after iter 5  PASSED
after iter 2  PASSED     after iter 6  FAILED   <- mine, not the product
after iter 3  PASSED     after iter 7  PASSED
after iter 4  PASSED     after iter 8  PASSED
                         after iter 9  PASSED
6j final gate            SKIPPED (clean entry for this exact hash, clean worktree)
```

The red was a false one I caused: I launched validation with `run_in_background` and kept editing
`tools/run-tests.sh`, which bash was executing, so it resumed at a stale byte offset (`line 191:
ob did (e.g. ...`, two bytes into "glob" on line 184). The file parsed clean at the time and at
HEAD, and the immediate re-run passed with zero syntax errors. Recorded rather than smoothed over.

### Strengths (across all iterations)

- Fixtures are real `git init` / `git worktree add` repos, with two FIXTURE arms asserting the
  `.git` directory-vs-file shape first, so every later assertion goes red rather than vacuous if git
  changes its layout.
- The fail-open arm executes `run-tests.sh`'s OWN bytes, extracted with awk, rather than a re-typed
  copy, fenced by both a substring check and structural if/else/fi counts.
- The `$HOME` decline uses `-ef` and is load-bearing on this machine, not in principle:
  `/Users/agent1` and `/System/Volumes/Data/Users/agent1` share device 16777233 and inode 265628,
  and the live board runs from `$HOME`.
- The library runs no subprocess at all, so `seen_before()` gains no unbounded probe against a
  possibly-wedged path, and the environment cannot redirect the answer.
- Every guard was perturbation-tested, each perturbation reddening its own arm, and reviewers at
  iterations 8, 9 and 10 independently reproduced those perturbations on scratch copies.
- `package.json`'s `test:shell` was extended by pure append and verified by diffing step NAMES
  rather than counts, which is the failure mode that silently deleted another suite's step on a
  previous branch.

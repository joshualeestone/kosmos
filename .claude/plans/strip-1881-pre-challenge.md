---
pre_challenge: true
method: challenge-loop
branch: strip-1881
diff_hash: 2e1c84f526cb8251acda4bba3b67d50f7552c7d498b3806b547d9781d12befd7
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T20:07:20Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (both blind passes returned zero BLOCKER/WARNING/CONVENTION)
**Converged:** Yes
**Total findings:** 6 (0 BLOCKER, 0 WARNING, 0 CONVENTION, 6 NIT)
**Fixed:** 5 | **Deferred:** 1 | **Asked:** 0

Two independent blind passes both found the strip complete and the guard armed,
non-vacuous, and correct in both directions. No actionable findings in either.

### Per-Iteration Breakdown

#### Iteration 1
Zero actionable. NITs:
- [NIT] web.room-761.test.js - the link-preview description "Ebooks you own." was
  Book.io's product tagline --> FIXED (neutralized to "An example page."; not a
  guarded spelling, done for Josh's "any way, shape, or form" ruling; bare
  "Ebooks" deliberately NOT added to the guard - too generic)
- [NIT] guard - line-based scan misses a token split across a hard wrap --> FIXED
  (documented in the guard; negligible for emails/URLs/$STUFF which are single tokens)
- [NIT] plan contains organization: 'Book' documenting the swap --> no action (allowlisted plan)

#### Iteration 2 - CONVERGED
Zero actionable. NITs:
- [NIT] the git ls-files floor >100 is loose vs the ~1400 real count --> FIXED
  (raised to >1000 so a PARTIAL enumeration also fails, not only an empty one)
- [NIT] negative-control list omits some stem words --> FIXED (added facebook,
  audiobook, bookkeeping, "stuffed animals", "book io with a space")
- [NIT] /\$stuff/i matches $stuff as a substring ($stuffed would trip) --> DEFERRED:
  kept deliberately, it also catches real refs like $STUFF_BALANCE that a word
  boundary would miss; the tree is clean today. Reasoning noted in the guard.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | NIT | web.room-761.test.js | Book.io tagline in fixture | FIXED |
| 2 | 1 | NIT | no-brand-refs-1881.test.js | line-based scan wrap limit | FIXED (documented) |
| 3 | 1 | NIT | strip-1881.md | 'Book' residual in the plan | no action (allowlisted) |
| 4 | 2 | NIT | no-brand-refs-1881.test.js | ls-files floor too low | FIXED (>1000) |
| 5 | 2 | NIT | no-brand-refs-1881.test.js | negative controls thin | FIXED |
| 6 | 2 | NIT | no-brand-refs-1881.test.js | $stuff substring match | DEFERRED (deliberate) |

### The finding worth keeping past this card
A literal search for a string is BLIND to that string's regex-escaped spelling and
returns a clean zero. One of the 53 hits was a regex literal recorded@book (dot
escaped with a backslash); the substring book.io does not occur in that escaped
form, so a literal sweep AND a literal strip both missed it. It surfaced only
because a test assertion still referenced the old value and went red. Same class as
the em-dash rule's source-escape spelling: the form that hides is the one written
for a machine, not a human. The guard's matcher makes the separator flexible
(an optional backslash) and proves it with a positive control plus a planted
escaped-form perturbation.

### Iteration 3 - scope correction (Splinter's forward-risk catch, pre-merge)
Splinter flagged that the guard would red on the migration itself: `.claude/plans/`
legitimately accrues book-io mentions (every repoint proof names the repo it moved
away from), and a guard that reds on legitimate content gets disabled. Fixed:
the guard now EXCLUDES `.claude/plans/` and scans everything else (code, tests,
web/, docs, README, tools, .github, non-plan .claude/ config). A blind pass
confirmed the predicate is edge-case-proof (trailing-slash prefix) and the scoping
control is real in both directions (a plan path is exempt AND a code path is
scanned), perturbation-proven each way. NIT fixed: reconciled the plan's stale
"Allowlist" prose with the prefix-exclusion model.

### Strengths
- The guard is a genuinely non-vacuous deliverable: positive control (matches
  every spelling incl. escaped), negative control (rejects neutral English), a
  git ls-files floor, an existence-checked minimal allowlist, and it is armed by
  the *.test.js glob (confirmed by tools.every-test-runs discipline).
- Fixture swaps preserve same-vs-different account relationships exactly, so
  neutralization does not weaken any test (291/291 across the four affected files;
  server.test.js 252/252 with a regex assertion fixed, not weakened).
- No executable behavior changed: every live-code swap is inside a comment.

### Validation
- Full suite (bash tools/run-tests.sh) run to completion untimed: node --test 3769
  tests, 0 fail; the guard runs in-suite. Re-run as the 6j closing gate.
- Perturbation-proven: the guard reds on planted plain AND escaped violations, and
  passes clean otherwise; and reds on a code hit but NOT a .claude/plans/ hit.
- CI browser-check gate (#1720): the only web/ change is comment-only, cleared
  with a `Browser-check:` commit trailer (the node suite and the guard both pass).

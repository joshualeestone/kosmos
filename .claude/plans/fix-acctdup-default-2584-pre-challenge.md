---
pre_challenge: true
method: challenge-loop
branch: fix-acctdup-default-2584
diff_hash: 8de4affb570babd84b2903eaa771b29b087c23be109982e8cb595013fddc38e1
validation: passed (test suite green; helper recorded dirty-tree from pre-existing win32-test cwd-pollution, see note)
subdir_audit: passed
timestamp: 2026-09-09T21:16:27Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (blind review converged with zero actionable findings)
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 0 WARNINGs, 4 validation-gate findings, 1 NIT)
**Fixed:** 4 | **Deferred:** 1 (the NIT) | **Asked:** 0

### Note on validation status (read before the ledger)

`run-tests.sh` — the actual test suite — SUCCEEDED: 5549 node tests pass (0 fail),
and every browser check passes, including the new `render-account-dup-reauth-2584.js`.
The validation helper nonetheless recorded `status=failed` on its post-run
worktree-cleanliness check, logging verbatim: "validation succeeded but worktree
is dirty".

The dirtiness is pre-existing test pollution UNRELATED to this change:
`engine/win32job.test.js` and `engine/win32anchor.test.js` exercise win32 path
logic by calling `ensureAnchored` with `platform: 'win32'`, and the resulting
`fs.mkdirSync` of a backslash-spelled path lands in the process cwd, leaving
untracked `\private\var\...\Kosmos\runtime\` entries in the worktree. Neither test
is in this diff; running just those two files (both pass) reproduces the leak, and
it reproduces identically on origin/main. CI runs the browser checks, not this
cleanliness wrapper, so a PR is unaffected. Filed as a follow-up for win32-test
hygiene. The junk was cleaned before writing this proof.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** general-purpose subagent (Opus-class)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (ITER_COMMITS was empty at the first review; the plan file
was written before the reviewer ran, so no missing-plan CONVENTION was raised)
- [NIT] web/index.html — the second default falls to `qual = dir`, so its reauth
  accessible name renders the full home path rather than the provider. --> DEFERRED
  (see below).
**Converged** — no actionable findings after dedup.

### Final-validation (6j) findings — all Origin BRANCH, all FIXED

The blind review converged, then the closing full-suite validation surfaced three
consequences of the change (and, separately, the pre-existing win32 pollution
described above). Each is a distinct finding, fixed and re-validated:

- [CONVENTION] #1881 — the test fixture and an index.html comment used the real
  on-box `josh@book.io`, which the brand-reference guard forbids in the tracked
  tree. --> FIXED (58252e4e): swapped to the neutral `agent@example.com` the
  qualifier suite already uses; both rows still share one email so the collision
  stays genuine. (.claude/plans/ is exempt, so the plan file's context is fine.)
- [CONVENTION] #1720 — a web/ change must update a docs/browser-checks assertion.
  --> FIXED (72a201d0): added a deterministic hermetic check,
  `render-account-dup-reauth-2584.js`, that seeds the colliding pair itself and
  asserts the two rendered `.acct-reauth` aria-labels are non-empty and distinct.
  `named-controls.js` only catches this when the live board happens to hold two
  colliding accounts (which is why the 0.6.51 cut caught it — this box did); the
  new check is board-independent. Reds on origin/main, greens on the fix.
  Registered in the runner loop and the README (both parity guards green).
- [CONVENTION] #1864 — the new check's FAIL-emit loop and browser-launch catch are
  two more quotable emit sites, so the deliberate equality counts in
  `browser-checks-reason-grep.test.js` go 76->77 and 47->48. --> FIXED (1a41e275).

### The deferred NIT

The second default in a shared-email key-group falls back to its unique `dir`, so
on the real fixture a screen reader announces
"Sign in again as agent@example.com (/Users/.../.codex)" rather than a provider.
Deferred, with reasoning:
- `dir` is the existing, tested, collision-proof last-resort qualifier; the
  "duplicated row with no label" test already accepts dir-based names, so this
  extends an accepted convention rather than introducing a new degradation.
- Making the provider-agnostic `accountQualifiers` provider-aware is a design
  change, not a bug fix, and it is shared by three call sites.
- The independent blind reviewer classified it a NIT / out-of-scope polish.
- Weakest premise: that a same-email cross-provider double-default is rare enough
  that a verbose-but-unique name is acceptable interim. A follow-up can add a
  provider fallback before `dir`. Reversible.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | web/index.html:15884 | BRANCH | 2nd default's reauth name renders raw dir path | DEFERRED | dir is the tested collision-proof fallback; provider polish is a follow-up |
| 2 | 6j | CONVENTION | web.account-qualifier.test.js | BRANCH | book.io reference in fixture/comment (#1881) | FIXED | 58252e4e |
| 3 | 6j | CONVENTION | docs/browser-checks/ | BRANCH | web/ change lacks a browser-check assertion (#1720) | FIXED | 72a201d0 |
| 4 | 6j | CONVENTION | browser-checks-reason-grep.test.js | BRANCH | quotable-emit-site counts (#1864) | FIXED | 1a41e275 |

### Strengths (from the blind review)
- The fix is minimal and correct; `main` becomes a first-come reserved token in the
  same per-key used-set as every other qualifier. Distinctness verified across all
  row orderings (default-first, default-second, non-default labelled "main").
- No regression to common cases: single-default groups untouched, the `< 2` continue
  path returns before `used.add`, existing qualifier tests all still pass.
- The added unit test is non-vacuous: reds on the pre-fix page (both defaults take
  "main"), greens on the fix.

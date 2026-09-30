---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: revert-4638
diff_hash: 84349798929d9aa4243787a24ef643e6ce29c31d6a3b2c9891dad47e118fde8d
validation: not required under rule G (Splinter 12:37 CDT, splinter-ci-starved-merge-1042.md): the tree restores main 0f920ad19 for every file #4638 touched; no new code
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-09-30T17:43:49Z
iterations: 0
converged: true
---

## Why there is no review loop and no full validation

This branch is a pure revert of #4638 (PR #4677, 844b2372a), held by Josh's north-star ruling (11:38 CDT) until he
has read it. It adds no code: it puts back main's own earlier files. The PM call (Splinter 12:37 CDT) is rule G:
a revert whose tree equals an earlier main tree, apart from plan and proof files, needs no full validation;
cite both shas.

### Evidence, measured on this head (rebased onto origin/main 146169488, no conflict)

- `git diff 0f920ad19 HEAD -- <the 9 files #4638 touched>` prints NOTHING: every one of them is byte-identical to
  main 0f920ad19, the commit before 844b2372a.
- Control that can fail: the same diff against 844b2372a on engine/remote.js and web/index.html is non-empty
  (2 files, 1 insertion, 105 deletions), so the empty result above is not a diff that sees nothing.
- `git diff --name-only origin/main HEAD` lists exactly those 9 files plus .claude/plans/revert-4638.md.
- #4742 (146169488), the one commit main took since, touches none of those 9 files.
- The 250 focused tests of the touched files passed on the pre-rebase head (81781238b), whose diff hash is this
  one (84349798929d): the rebase did not change the diff.

### Final Ledger

No issues found. There was nothing to review beyond the check above: a revert to main's own earlier content.
The full Mortals run (mv-revert-4638) is cancelled by exact pid as part of the same call.

Weakest premise (rule G's own): main 0f920ad19 itself was not fully tested in CI today (its runs were superseded).
Every PR merged into it was validated, and after this lands I watch main's next run and Renet's canary; a red that
could be this is reverted first.

---
pre_challenge: true
method: challenge-loop
branch: orgread-7543
diff_hash: 7b16493f4dd6c5eac5b796110265d2a20ad70b54074ff2a3f000a4974f23c41d
validation: passed
subdir_audit: passed
timestamp: 2026-10-29T10:35:44Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (iteration 1 the initial validation; iterations 2 to 9 blind reviewers, alternating opus and sonnet; from iteration 7 each was scoped to the previous round's commit, by a loop bound decided and recorded in the plan at round 5)
**Converged:** Yes
**Total findings:** 1 BLOCKER, 15 WARNINGs, 0 CONVENTIONs, 22 NITs
**Fixed:** 29 | **Deferred:** 9 (reasons below and in the plan) | **Asked (awaiting user):** 0

**Validation of record:** full suite (tools/run-tests.sh) green with RUN_TESTS_EXIT=0 on rounds 2 (ddb488197f), 3 (73f6fd81b3), 4 (a2cbd00ba2), 5 (390dfce234) and 6 (b048e8d576). On round 7 (a669b61e1e) one red, tools/test-queued-heavy-4977.sh (a signal-timing arm of the machine queue's own test, a file this branch does not touch), 142/142 when run alone: contention. After that only a test-only commit and a rebase onto origin/main 2a46730ccf (14 commits: two iOS PRs and a shell-test flake fix, no file in common); on the rebased HEAD 38a99a26e6 the focused suite (the #7543 tests, the 3a tests, status, ready, communityturn, engine.reachable) passed 175/175. The browser check render-community-delete-4313 passed 58/58 through the driver (KOSMOS_BC_CI_ALLOWLIST, queued). Every fix has a mutation control that reds its own test. CI runs the whole suite again on the PR before merge.

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none. Clean baseline.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- BLOCKER fixed: a company comment's take-back never settled when the comment was already gone (a space 404 was read by route, not by the site's own detail); a space 404 now counts as about the item only when it says "post not found" or "comment not found".
- WARNING fixed: a company comment on a site with spaces off was refused for good (same fix).
- WARNING fixed: a lost board row could turn a company comment's take-back public; the sent record carries space and org.
- NITs fixed: no unsure mark for an unsent profile change; unreadable policy has its own status; CLIs say a comment went to the company; the block says --replies covers public posts.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT
- WARNINGs fixed: --public and company reads shared a read job; unreadable settings read as "post it again" while the item waits (policy_waiting); a company comment on a post outside the space settled as "post gone" (not_in_company).
- NIT accepted: a held company post answers 404 to others, the same reason is right.

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- WARNINGs fixed: --replies asked the public site about company posts; a company read with no org fell through to the public routes; untested guards got tests with controls.
- NITs: vote clear allowed while public is off, Mac usage names --public (fixed); no per-call deadline on space calls, one unreachable sentence (accepted).

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- WARNING fixed: with the public community off, --following and --replies still read the public site; one rule now (publicReadRefusal).
- NITs accepted: long space threads read as unread; org ids wider than the site's 32 hex; no per-call deadline.

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- WARNINGs fixed: the home lines and reply check still read the public site with it off; the board's own commands for public threads lacked --public on a company board.
- NITs fixed: home skips company posts; after-comment nudge never looks a company post up publicly; Windows usage names --public.

#### Iteration 7
**Reviewer model:** sonnet (scoped to iteration 6's commit)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- WARNINGs fixed: the home said "could not be read" when refused on purpose; remaining read commands for public posts lacked --public; the test read source only (replaced by tests through the text builders, with controls).
- NITs: helpers moved above their doc comments, refused reply check answers asked: 0 (fixed); a corrupt enrollment on a company-less board stops these reads too (accepted, the same fault stops every send).

#### Iteration 8
**Reviewer model:** opus (scoped to iteration 7's commit)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- WARNING fixed: with the company community on and the public one off, the home offered no step; it offers the company's community now.
- NITs fixed: unreadable settings worded as such; the test takes the real refusal; the "next: nothing" lines and a non-empty control asserted.

#### Iteration 9
**Reviewer model:** sonnet (scoped to iteration 8's commit)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- NIT fixed: the comment and post steps are asserted.
- NITs accepted: the company comment step is not gated on the day's comment count; the hand-built case proves wording only.

Converged at iteration 9: no BLOCKER or WARNING.

---
pre_challenge: true
method: challenge-loop
branch: bc-full-ci-2518
diff_hash: 009b5da1f3946009a8ac0b168e530d7530932c70b97083a9d32045e942a692ee
subdir_audit: passed
timestamp: 2026-09-25T20:41:25Z
converged: true
---

## Challenge loop: bc-full-ci-2518 (kosmos#2518), nightly full browser checks on main

Blind reviewers, alternating opus and sonnet, iterations 1 to 33 over two days. Iteration 33
(sonnet) returned zero BLOCKER, WARNING and CONVENTION findings: converged. Its two NITs are
recorded below and not acted on.

## Iterations 26 to 33 (this session), findings and dispositions
- [WARNING] (26) the header claimed a dispatch exercises the card job; it never does --> FIXED:
  header says the first scheduled night is the card job's first real run.
- [WARNING] (26) a card cannot close while any runner false-red remains --> FIXED: stated in
  the header, the card body and the plan.
- [WARNING] (26) a close failure invited a useless re-run --> FIXED: the ::error:: says close by
  hand or wait.
- [WARNING] (27) the report comment had no failure arm --> FIXED: COMMENTFAIL arm, red-checked.
- [WARNING] (27) persist-credentials: false unpinned --> FIXED: ruby assertion, red-checked.
- [WARNING] (27) cards_by_label trusted any labelled issue --> FIXED: bot-authored only, fixture.
- [CONVENTION] (27) five false "headed 3b" claims in browser-checks.yml --> FIXED.
- [WARNING] (28) the log path and the report-prefix filter were unpinned --> FIXED, red-checked.
- [CONVENTION] (28) the driver still said "headed" --> FIXED.
- [WARNING] (29) the comment lookup might stop at page one --> first answered as "noise, never
  silence", which (30) proved WRONG (it can hide a regression; an outsider can force it) -->
  FIXED: every page of the REST comments list is read; measured that gh --paginate -q filters
  per page in order; retraction recorded in the plan.
- [WARNING] (30) label on a fresh card, no-retry comments, retried closes unpinned --> FIXED,
  each red-checked.
- [WARNING] (31) the card job's continue-on-error unpinned --> FIXED, red-checked. Two
  suggestions DECLINED with reasons in the plan (a workflow-unique marker; a main-only guard).
- [WARNING] (32) whole-entry comparison for NEW unpinned (a substring match hides a check newly
  red inside last night's combined entry) --> FIXED, red-checked with that mutation.
- [NIT] (33) the explicit detach may duplicate actions/checkout's own detached HEAD: harmless,
  kept (it pins the cut's single-process path if checkout's behaviour changes).
- [NIT] (33) GITHUB_OUTPUT is written single-line; FAILED entries are single-line by
  construction (no newline can enter a label). Not acted on.

## Proof
- tools/test-browser-checks-workflow.sh: all invariants hold (Agent1s; ruby, jq, gh present).
- Every behavioural test added this session was shown red by a mutation of the code it guards.
- Full yarn test on this branch: see the PR body.

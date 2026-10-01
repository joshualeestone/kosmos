---
pre_challenge: true
method: challenge-loop
branch: inbox-4784
diff_hash: 2e5bb17055fa6cdafece5929fee94ba679d5c668624be0e3112da351722891e3
validation: passed (Mortals) on head daf98998d, full suite 13129 tests / 0 fail, hash 2e5bb17055fa, 20:46 CDT 2026-09-30
subdir_audit: passed
timestamp: 2026-10-01T01:47:00Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind reviewers, separately spawned (sonnet, opus, fable, sonnet, opus, fable, opus, sonnet).
**Converged:** Yes. Round 8 (sonnet) returned no BLOCKER or WARNING.
**Findings:** every WARNING taken. NITs were taken, or declined with a reason (plan: .claude/plans/inbox-4784.md).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] `kosmos inbox --help` re-dispatched bare and printed the messages --> FIXED (its own help arm)
- [WARNING] the setup guide's thread was not masked --> FIXED (guideMaskedRows, every row)
- [WARNING] Kosmos's own notice printed as "you:" --> FIXED (left out)
- [WARNING] a message's further lines could pass for another row --> FIXED (indented)
- [WARNING] attachments, menu choices and undelivered messages not said --> FIXED
- [WARNING] board-token reach undocumented --> FIXED (comment and plan)

#### Iteration 2
**Reviewer model:** opus
- [WARNING] unconfirmed delivery read as "did not reach you" --> FIXED ("may not have reached you")
- [WARNING] token-over-pane untested --> FIXED
- [WARNING] guide mask untested --> FIXED (real guide fixture)
- [WARNING] the Windows verb untested --> FIXED

#### Iteration 3
**Reviewer model:** fable
- [WARNING] the board-token + pane path had no route test, and the token-wins arm could not fail (fake-tmux names one session) --> FIXED (mapped panes, with a control)
- [NIT] UTC stamps, rows with no delivery field, the BAD_THREAD 503, row size --> NOT TAKEN (reasons in the plan)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] a lone CR, VT, FF, NEL, U+2028 or U+2029 in a message could draw an unindented row --> FIXED (every break starts an indented piece; controls dropped)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] attachment names skipped that rule --> FIXED (INBOX_BREAK / INBOX_DROP shared by text and names)
- [NIT] bidi controls --> FIXED

#### Iteration 6
**Reviewer model:** fable
- [WARNING] the plan and a test comment said Mac agents carry no agent token (they do: the supervisor mints one) --> FIXED (record corrected; no product change)
- [NIT] inbox dispatch pinned, U+061C dropped, names joined with "; " --> FIXED

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the INBOX constants split resolveAgentSender from its doc comment --> FIXED (moved above that doc)
- [NIT] a stored `at` reached the row unsanitized --> FIXED (only the board's ISO shape is printed)

#### Iteration 8
**Reviewer model:** sonnet
No BLOCKER or WARNING (converged).
- [NIT] invisible format characters kept; "; " inside one marker --> NOT TAKEN (reasons in the plan)

### Perturbations (each red by name)
The from_pane parse, the line-break split, the name sanitizing, U+061C and the ISO guard: each removed reds exactly its arm.

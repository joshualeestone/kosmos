---
pre_challenge: true
method: challenge-loop
branch: runnerlink-8724
diff_hash: c010b376aa660a4268bccc01bc8b8011dccd158c7357cff52a67ae6174a3bc68
validation: full suite on Mortals for this branch at f23cee883 (before its rebase) ran 29,916 tests, 29,301 pass, 2 fail, both guards main added (fixed: the setExpectedSource seam excused here, the Windows test list on item 2, since merged); after rebasing onto main, its tests and those guards pass (111); GitHub CI is the gate on this PR
subdir_audit: passed
timestamp: 2026-11-19T18:49:08Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (round 6 raised no BLOCKER, WARNING or CONVENTION)
**Fixed:** every WARNING and CONVENTION of rounds 1 to 5 | **Deferred:** the NITs listed below | **Asked:** 0

Record kept during the run in ~/.cache/claude-handoffs/angel-8724-review-ledgers-20261119.md. The review diff base was
adoptlink-8724 at 7f07760108 (#8724 item 2, since merged as #8745); rebased onto main since.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] engine/linkwindow.js: a Claude window under a Codex record linked, and a later launch job would stamp codex on it --> FIXED (the record decides for Claude windows too)
- [WARNING] engine/linkwindow.js: a Claude link ignored a stray runner mark --> FIXED
- [WARNING] engine/linkwindow.js: an agent-mark write failure said "Nothing was changed" with a runner note left --> FIXED
- [WARNING] engine/linkwindow.js: a runner note left alone was reported as markLeft --> FIXED (only the agent mark is)
- [NIT] a/an, Gemini and Muse words, the no-record next step, the server test pinned, a finally reset, a stale CLI comment, the supervisor test header --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] engine/linkwindow.js: the markLeft path took the runner note off a window still marked ours --> FIXED
- [WARNING] engine/linkwindow.js: a failed runner read was taken for no mark --> FIXED (show-options -q, measured on tmux 3.6a)
- [NIT] no unset after a failed runner write --> FIXED; [NIT] Grok row in the supervisor test --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] engine/linkwindow.js: an agent set that reported failure but applied lost its runner note --> FIXED (read back first)
- [WARNING] engine/linkwindow.js: an unreadable record was taken for "no record" --> FIXED
- [WARNING] engine/linkwindow.js: the Claude runner check read only the board's earlier look --> FIXED (the runner is read in the link's own look)
- [CONVENTION] engine/linkwindow.js: the header still said Codex is refused --> FIXED
- [NIT] unset only this call's runner value, a missing note in one sentence, plan counts, the supervisor test asserts the runner it records --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] engine/linkwindow.js: a runner write that reported failure but applied --> FIXED
- [WARNING] engine/linkwindow.js: the agent unset after a failed set could remove a foreign value --> FIXED
- [WARNING] plan: "a Claude window links exactly as before" no longer true --> FIXED
- [NIT] a redundant condition --> FIXED

#### Iteration 5
**Reviewer model:** opus
- [WARNING] install/kosmos: the CLI promised a Codex window's conversation now, but the board reads those only from a launch job --> FIXED
- [WARNING] engine/linkwindow.js: a foreign-mark refusal hid this call's runner note --> FIXED
- [WARNING] engine/linkwindow.js: a record with no provider was called "a Claude agent" --> FIXED ('unstated')
- [NIT] plan-time runner check for every runner, a softened comment, the server stand-in reads by -t --> FIXED; [NIT] a gone-session sentence --> DEFERRED (harmless)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs. **Converged.**
- [NIT] the linkwindow header over-claimed which checks apply --> FIXED after convergence (comment only)
- [NIT] an unchecked cleanup unset, a comment on raw vs normalised runner, the preview's two-line join, the unparseable-profile wording --> recorded

### After the loop
- The setExpectedSource test seam excused in engine.reachable.test.js (#5548), a guard main added.

### Strengths
- [STRENGTH] The runner is recorded before the agent mark and comes off only after it, so a window is never Kosmos's with an empty runner (read as Claude).
- [STRENGTH] The real supervisor adopts a linked codex, codex.exe, agy and grok-native window and records the job's runner (supervisor.adopt-runner-linked-8724.test.js, with a shell control).

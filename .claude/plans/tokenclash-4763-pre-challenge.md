---
pre_challenge: true
method: challenge-loop
branch: tokenclash-4763
diff_hash: 7dd643b60e941febc56ce9a2d03871969fe5591803768d90a7064990f3083686
validation: passed (Agent1s full suite on head b2e237d52, 13117 tests / 0 fail, SUITE_RC=0, both browser-check gates rc 0, 19:22 CDT 2026-09-30; Mortals held for the 0.7.14 cut)
subdir_audit: passed
timestamp: 2026-10-01T00:24:11Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind reviewers, separately spawned (sonnet, opus, fable, sonnet).
**Converged:** Yes. Round 3 (fable) and round 4 (sonnet) returned no BLOCKER or WARNING.
**Findings:** 4 WARNINGs, all taken; NITs taken or declined with a reason (the plan, .claude/plans/tokenclash-4763.md).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] resolveAgentSender's paneless fallback re-admitted a clash-refused token by key --> FIXED (sendertoken.CLASH, kept by resolveAgentSender; test with a control)
- [WARNING] resolveName (key-level callers: outbox keep-time sender, token-only reads) still treats the twins as one identity --> FILED #4792, pinned in the test
- [NIT] the comment claimed to cover a stopped twin --> FIXED (reworded; in #4792)
- [NIT] resolveName's answer for the clash unasserted --> FIXED

#### Iteration 2
**Reviewer model:** opus
- [WARNING] POST /api/agent-token minted "mara" into running pane agent "Mara"'s file, resolving AS Mara --> FIXED (409; control: own spelling issued)
- [WARNING] "never as the other's NAME" was false (the key IS mara's name) --> FIXED (comment, plan, #4792 corrected and raised)
- [NIT] a clash leaves no trace --> FIXED (one log line per clash)
- [NIT] the JSON leak assertion cannot fail while the mark is a Symbol --> FIXED (labelled a regression guard)

#### Iteration 3
**Reviewer model:** fable
No BLOCKER or WARNING (converged).
- [NIT] the route fails open on an unreadable roster --> FIXED (503, nothing written)
- [NIT] "running" overclaims --> FIXED
- [NIT] the clash log never re-arms --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
No BLOCKER or WARNING (converged).
- [NIT] re-arm only on a clean resolve --> NOT TAKEN (only a later log line is lost; the refusal is unaffected)
- [NIT] the 503 depends on snapshot() --> NOT TAKEN (fail-closed and retryable, by design)
- [NIT] the log assertion matches on the quoted key --> NOT TAKEN (the key is unique to the test)

### Perturbations (each red by name)
The server guard, the CLASH mark, the route guard, the 503 and the log re-arm: each removed reds exactly its arm.

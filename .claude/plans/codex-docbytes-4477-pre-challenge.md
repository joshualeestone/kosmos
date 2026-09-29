---
pre_challenge: true
method: challenge-loop
branch: codex-docbytes-4477
diff_hash: 0f7caa5f277a9e9527114683ee15b96c9dc31078c34d3e9dfb0b70f1cbb13eaf
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T04:31:27Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet)
**Converged:** Yes (iteration 4's one WARNING duplicates iteration 2's, handled by narrowing the claim; the behavioural shell test is the guard)
**Total findings:** 6 actionable WARNINGs, plus NITs
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

⚠️ **Disclosures:** three validation runs were stopped by me (my own processes in this worktree only) because their code was superseded mid-run. Origin set by reading, recorded BRANCH (fail-safe); iteration 3's finding was in my own iteration 2 prose, and the false sentence was deleted, not rewritten. A bulk replace once rewrote a measured value in the plan; it was caught, and the new value was measured before being recorded.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] engine/codex-docbytes-4477.test.js — the Mac check read the script's text only --> FIXED (ef4d08fff): tools/test-supervisor-model-2140.sh now asserts `-c project_doc_max_bytes=...` in the real supervisor's recorded argv, both codex arms, with a claude-arm control; measured red with the flag removed
- [WARNING] bin/agent-supervisor.sh — the Mac value not named as a copy --> FIXED (ef4d08fff)
- [WARNING] plan — a resumed Windows thread started before the change unstated --> FIXED (ef4d08fff)
- [NIT] a person's own higher value is lowered; shared budget across AGENTS.md files --> recorded in the plan

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] engine/win32codex.js — the limit equalled the cap exactly --> FIXED (c836d3de0): twice the cap; 524288 measured with `codex debug prompt-input` (marker present; default absent)
- [WARNING] plan — overclaimed what the JS test checks --> FIXED (c836d3de0): the shell test named as the behavioural guard
- [NIT] win32launch.argvFor never used for codex --> recorded in the plan

#### Iteration 3
**Reviewer model:** opus
- [WARNING] engine/win32codex.js, bin/agent-supervisor.sh, test, plan — the stated reason for 2x was false (Kosmos never lets its own file exceed MAX_BYTES) --> FIXED (dcba4fe24): the false sentence deleted; the true reasons stated (codex's budget spans every AGENTS.md from the repository root down; a hand-edited file)
- [NIT] comments disagreed on the value --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] engine/codex-docbytes-4477.test.js — a third launch shape would escape the text check --> duplicate of iteration 2 (handled; no current defect, confirmed by the reviewer)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-supervisor-model-2140.sh | BRANCH | behaviour not asserted | FIXED | ef4d08fff |
| 2 | 1 | WARNING | bin/agent-supervisor.sh | BRANCH | copy not named | FIXED | ef4d08fff |
| 3 | 1 | WARNING | plan | BRANCH | resumed thread unstated | FIXED | ef4d08fff |
| 4 | 2 | WARNING | engine/win32codex.js | BRANCH | no headroom | FIXED | c836d3de0 |
| 5 | 2 | WARNING | plan | BRANCH | test claim overstated | FIXED | c836d3de0 |
| 6 | 3 | WARNING | comments, plan | BRANCH | false reason for 2x | FIXED | dcba4fe24 |

### Validation
- Final validation (6j) on dcba4fe24: PASSED, hash 0f7caa5f277a, 11599 node tests / 0 fail, shell suites (including test-supervisor-model-2140) clean, subdir audit clean.
- Measured with codex-cli 0.149.1 `debug prompt-input`, no account: a 42 KB AGENTS.md loses its last line by default and keeps it with -c 262144 and with -c 524288.
- Controls measured red: the Mac flag removed from one launch (JS test) and from both (shell test, both codex arms); the Windows value changed.

### Strengths
- [STRENGTH] Every codex launch that reads AGENTS.md is covered: the two Mac new-session lines and the Windows per-turn `codexTurnArgs`; sign-in, doctor and probe calls do not read AGENTS.md.
- [STRENGTH] The Windows value is computed from workerfile.MAX_BYTES; the Mac copy is held equal by a test and checked in the real launch argv.

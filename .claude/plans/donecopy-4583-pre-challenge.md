---
pre_challenge: true
method: challenge-loop
branch: donecopy-4583
diff_hash: 2f0f3c97c6d6c8bf52c9491edab47a47634e7b02235fc7e3be096df64e83070e
validation: focused per iteration (web.* 2198/0, web.done-copy-4583 3/3, browser-checks meta, surface gate 0); the full suite runs once on Mortals on the head carrying this proof, and its result is recorded on the PR
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-09-30T17:31:54Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6: no BLOCKER, WARNING or CONVENTION)
**Total findings:** 9 (0 BLOCKERs, 8 WARNINGs, 1 CONVENTION-level plan note, plus NITs)
**Fixed:** 6 | **Deferred:** 3 | **Asked (awaiting user):** 0

**Validation, stated plainly:** the pre-PR helper (`validation_log_run_or_skip`) was not run per
iteration. On Kosmos the full suite goes to Mortals once, at convergence, because the shared Mac's
test queue is hours long (Splinter's rule of 2026-09-30). Each iteration ran instead: every `web.*`
test (2198, 0 fail; one first run of iteration 5 had 15 fails, all in `web.not-running.test.js`, a
server-boot timeout at load average 4 to 6 in a file this branch does not touch; alone 16/0, and the
full re-run on the same head 2198/0), the new guard, the browser-check meta tests and the #2518
surface gate (0). The rendered check, `render-project-done-4583` plus a control on main's page, is
queued on the shared Mac.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty)
- [WARNING] web/index.html:15621 — hint "Skip it and the team will ask you" promised a question from a team that may not exist --> FIXED (9f0e8437e)
- [WARNING] web/index.html:61211 — the too-long error named the field in the old words --> FIXED (9f0e8437e, "That answer is longer than"); the engine refusals are left, see Deferred
- [NIT] web.done-copy-4583.test.js:36 — the cap regex missed other spellings --> taken (/\bchar/i)
- [NIT] web.done-copy-4583.test.js:3 — the header overstated how loose the test is --> taken (claim deleted)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (line 61211 was written by 9f0e8437e; a code line, fixed normally)
- [WARNING] web/index.html:61211 — the new error text was pinned by nothing --> FIXED (7716221a6: the guard pins it and its description sibling)
- [NIT] docs/browser-checks/README.md:563 — row named the old label --> taken
- [NIT] web.done-copy-4583.test.js:16 — the field slice ended at the first </div> --> taken (ends at the error line)
- [NIT] hint scope; the HTML comment --> noted

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the hint line, written by 9f0e8437e; user-facing copy, fixed by narrowing it to what the code does)
- [WARNING] web/index.html:15621 — "the agents you put on it will ask you" dropped the creation-time limit: server.js posts the ask-for-done note only from the create handler and only when the project is created with agents --> FIXED (b3387e2fd, "Optional. If you skip it, one of the agents you add here will ask you.", which also takes the NIT that the note asks for one question from one agent)
- [NIT] engine refusal wording; browser-check message text; the description hint still names its cap --> noted

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the hint line; DEFERRED, not rewritten)
- [WARNING] web/index.html:15621 — the hint on a project created with no agents --> DEFERRED (below)
- [WARNING] no rendered check for a web/ change (#1720) --> FIXED (15c2ccec8: render-project-done-4583 asserts the label's words, the box's aria-label and the hint, as rendered)
- [NIT] .claude/plans/donecopy-4583.md — test counts stale --> taken
- [NIT] plan file name has no timestamp --> left (the directory's practice)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] web/index.html:15621 — "will ask" rests on an agent following a room note --> DEFERRED (below)
- [NIT] web/index.html:15616-15618 — the field's comment said "its Project Manager asks first" --> taken (0ede75c5a, says who asks and when)
- [NIT] the check's header and README row did not name the new assertions --> taken (0ede75c5a)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:15621 | BRANCH | hint promised a team that may not exist | FIXED | 9f0e8437e |
| 2 | 1 | WARNING | web/index.html:61211 | BRANCH | too-long error in the old words | FIXED | 9f0e8437e |
| 3 | 1 | WARNING | engine/projects.js refusals | BRANCH | engine refusals still say "What done looks like" | DEFERRED | the page routes them by exact text (web/index.html ~61274); renaming is a paired engine+page change in the build owner's code; recorded in the plan |
| 4 | 2 | WARNING | web/index.html:61211 | SELF | new error text unguarded | FIXED | 7716221a6 |
| 5 | 3 | WARNING | web/index.html:15621 | SELF | hint dropped the creation-time limit | FIXED | b3387e2fd |
| 6 | 4 | WARNING | web/index.html:15621 | SELF | hint shown for a project created with no agents | DEFERRED | its subject is "the agents you add here": with none added it promises nothing |
| 7 | 4 | WARNING | docs/browser-checks | BRANCH | no rendered check (#1720) | FIXED | 15c2ccec8 |
| 8 | 5 | WARNING | web/index.html:15621 | BRANCH | "will" rests on an agent following a note | DEFERRED | the note directs the Project Manager, or one agent, to ask; that is the product's behaviour, and "may ask" would hedge a promise the product makes |
| 9 | 4 | CONVENTION-level | .claude/plans/donecopy-4583.md | SELF | stale test counts | FIXED | 15c2ccec8 |

### Outstanding questions
None.

### NITs (non-blocking, across all iterations)
- The description hint still says "Up to 1000 characters" while the done hint no longer does (iterations 3, 6): deliberate, the done box's error says it when it matters.
- The engine refusals can surface the old phrase through a non-page caller (iterations 3, 5, 6): row 3.
- The plan file name carries no timestamp (iteration 4): the directory's practice.

### Strengths (across all iterations)
- The visible label and the aria-label are one question, asserted in the source and in the rendered page.
- The hint promises only what server.js does, checked against the create handler by three reviewers.
- The guard fails on main's page (0/3) and passes here (3/3).

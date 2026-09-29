---
pre_challenge: true
method: challenge-loop
branch: personal-instr-4446
diff_hash: fe875f17cd91e8999e311c9a717b3a57670b9bc79f488a2613d0a343987eb196
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T02:04:46Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10 returned no BLOCKER, WARNING or CONVENTION)
**Total findings (actionable):** 17 WARNINGs + 1 CONVENTION + 2 validation BLOCKERs, plus NITs
**Fixed:** 14 | **Deferred:** 6 | **Asked (awaiting user):** 0

⚠️ **Disclosures, stated rather than smoothed over:**
- The session restarted after iteration 1 (context restart at 19:52 CDT). Iteration 1's ledger did not survive; only its fix commit (58ccb7b68) and its message do. Its reviewer model was not recorded.
- The Origin column below was set by reading each finding, NOT by the 6c-bis blame lookup, which this run did not execute. Findings are recorded BRANCH (the fail-safe value). Several were in fact inside this loop's own earlier fixes; they are marked "(own fix)" in the description, and where one was a prose claim it was deleted rather than rewritten (iteration 3 header list, iteration 5 comments).
- One uncommitted rewrite (iteration 4) was lost by running a perturbation control before committing and restoring with `git checkout`; it was re-applied from the same edit script, re-tested and committed before any further control ran.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (pre-restart)
**New findings:** recorded only as its fix commit: server.js, keep the #1228 wrap inside its guard's window --> FIXED (58ccb7b68)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (see disclosures)
- [WARNING] engine/personalinstr.js — Codex/Gemini/Grok paths unverified --> FIXED (af7ff0f8f): read from each installed CLI; Codex AGENTS.override.md and Grok rules/*.md added
- [WARNING] engine/personalinstr.js — no per-account Codex/Grok test --> FIXED (af7ff0f8f)
- Validation red (surface gate, #2518) found on iteration 1's commit --> FIXED (trailers, final form in c5b22c640)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING, 4 NITs
- [WARNING] engine/personalinstr.js — Claude also loads <config dir>/rules/*.md; the header's file list (own fix) was wrong --> FIXED (263fd9766): rules scanned; the header list DELETED, not rewritten

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
- [WARNING] engine/personalinstr.js — rules folder listed eagerly on every read (own fix) --> FIXED (1e7816445): fixed files first, lazy walk
- [WARNING] engine/personalinstr.js — deep walk unbounded against loops/huge trees (own fix) --> FIXED (1e7816445): depth 4 / 500 entries, each cap with a one-step-inside control

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 WARNING, 5 NITs
- [WARNING] engine/personalinstr.js — whitespace-only files and path-scoped Claude rules reported as always followed --> FIXED (99495d9c5); claudeMdExcludes recorded in the plan
- NITs taken: stale function name in a comment (deleted), entry-cap comment overstated (deleted), sentence text cleared when hidden

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 4 NITs
- [WARNING] engine/personalinstr.test.js — symlink tests fail on Windows without privilege (own fix) --> FIXED (bf6a9c161): skipped on win32
- [WARNING] engine/personalinstr.js — symlinked rule folders not followed (own fix) --> FIXED (bf6a9c161)
- [WARNING] engine/personalinstr.js — front matter past 4 KB missed (own fix) --> FIXED (bf6a9c161)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 5 NITs
- [WARNING] engine/personalinstr.js — Gemini save_memory writes the same GEMINI.md --> DEFERRED: the installed Gemini CLI has no save_memory tool; its routing rules write the global file only for preferences the person states (measured in its bundle); recorded in the plan
- [WARNING] engine/personalinstr.js — no launch job fell back to the default home --> FIXED (56356a1ad): no job answers null
- NIT taken: empty front matter parsed across the body --> FIXED (line-based)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] engine/personalinstr.js — Windows readJob may call schtasks --> DEFERRED: status.js already calls readJob per agent on every status poll, so this read hits a warm cache (measured by grep); recorded in the plan
- [WARNING] server.js — the route field untested --> FIXED (fc7cbad0b), then strengthened in iteration 9
- [WARNING] engine/personalinstr.js — managed policy / claudeMdExcludes --> DEFERRED: a stated gap in the plan; managed policy files are not personal
- [CONVENTION] web/index.html — copy not signed off by its owner (Mona) --> DEFERRED: Mona reviews on the PR; the string is one place to change
- Validation reds on the same round, both BLOCKER, both own fixes: personalinstr.test.js became host-branching (now on the Windows CI list); an eval-sliced server test could not see paintPersonalInstr (now cleared inline) --> FIXED (fc7cbad0b)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 5 NITs
- [WARNING] server.test.js — the route test could only see null (own fix) --> FIXED (c5b22c640): seeds a launch job, asserts null then { tool: 'Claude Code' }; control (route hard-coded to null) measured red
- [WARNING] engine/personalinstr.js — a leaked CLAUDE_CONFIG_DIR / GEMINI_CLI_HOME / GROK_HOME in tmux (#3417 class) --> DEFERRED: nothing engine-side resolves it today; recorded in the plan
- NITs taken: leading BOM, own-property runner lookup

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings.

### Final Ledger (actionable only)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | server.js | BRANCH | #1228 wrap outside its guard | FIXED | 58ccb7b68 |
| 2 | 2 | WARNING | engine/personalinstr.js | BRANCH | CLI paths unverified | FIXED | af7ff0f8f |
| 3 | 2 | WARNING | engine/personalinstr.test.js | BRANCH | no per-account Codex/Grok test | FIXED | af7ff0f8f |
| 4 | 2 | BLOCKER | web/index.html | BRANCH | surface gate red | FIXED | c5b22c640 |
| 5 | 3 | WARNING | engine/personalinstr.js | BRANCH | Claude rules/ missed; header list wrong | FIXED | 263fd9766 |
| 6 | 4 | WARNING | engine/personalinstr.js | BRANCH | eager rules listing | FIXED | 1e7816445 |
| 7 | 4 | WARNING | engine/personalinstr.js | BRANCH | unbounded walk | FIXED | 1e7816445 |
| 8 | 5 | WARNING | engine/personalinstr.js | BRANCH | whitespace / path-scoped over-report | FIXED | 99495d9c5 |
| 9 | 6 | WARNING | engine/personalinstr.test.js | BRANCH | symlink tests on Windows | FIXED | bf6a9c161 |
| 10 | 6 | WARNING | engine/personalinstr.js | BRANCH | symlinked rule folders | FIXED | bf6a9c161 |
| 11 | 6 | WARNING | engine/personalinstr.js | BRANCH | long front matter | FIXED | bf6a9c161 |
| 12 | 7 | WARNING | engine/personalinstr.js | BRANCH | Gemini save_memory | DEFERRED | no such tool in the installed CLI |
| 13 | 7 | WARNING | engine/personalinstr.js | BRANCH | no job guessed default home | FIXED | 56356a1ad |
| 14 | 8 | WARNING | engine/personalinstr.js | BRANCH | Windows readJob cost | DEFERRED | already paid by status.js |
| 15 | 8 | WARNING | server.js | BRANCH | route field untested | FIXED | fc7cbad0b |
| 16 | 8 | WARNING | engine/personalinstr.js | BRANCH | claudeMdExcludes / managed | DEFERRED | stated gap in plan |
| 17 | 8 | CONVENTION | web/index.html | BRANCH | copy owner sign-off | DEFERRED | Mona on the PR |
| 18 | 8 | BLOCKER | tests | BRANCH | two validation reds | FIXED | fc7cbad0b |
| 19 | 9 | WARNING | server.test.js | BRANCH | vacuous route test | FIXED | c5b22c640 |
| 20 | 9 | WARNING | engine/personalinstr.js | BRANCH | leaked config dir (#3417) | DEFERRED | stated gap in plan |

### Validation
- Final validation (6j) on c5b22c640: PASSED, hash fe875f17cd91, 11495 node tests / 0 fail, shell suites and both browser-check gates clean, subdir audit clean.
- Controls measured red, then restored: Grok rules scan off; entry cap raised; depth cap removed; symlinked-folder follow off; route field hard-coded to null.
- Browser check render-personal-instr-4446: all pass against the real server.

### NITs (non-blocking, not taken)
- Copy "apply to your other <tool> sessions" is broad for a per-account agent (Mona owns the wording)
- Lede above says instructions are the only thing that survives a restart (copy, Mona)
- Each rules .md head is read twice (has + pathScoped)
- fakeCreate keeps an unused recordedRunner stub
- The route test leaves the agent's worker CLAUDE.md in the temp sandbox

### Strengths (across all iterations)
- Only `{ tool }` or null ever leaves the engine; painted with textContent; asserted at the real route and in the browser check
- Never throws; cannot turn the Instructions read into a 500
- The sentence cannot carry over between agents (reset and emptied at both sites)
- Each CLI's file list was read from the installed CLI on this Mac, not assumed

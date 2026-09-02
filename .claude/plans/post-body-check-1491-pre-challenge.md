---
pre_challenge: true
method: challenge-loop
branch: post-body-check-1491
diff_hash: 6cf09af411c01aa7a58fb215974aba9b199ecee7d869cbdab20e082935da86a7
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T03:34:15Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (two fresh, blind, independent passes)
**Converged:** Yes — iteration 2 returned zero NEW BLOCKER/WARNING/CONVENTION findings, and no unresolved ASKED findings.
**Total findings:** 8 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 4 | **Deferred:** 4 (3 with reasoning; 1 to follow-up card #1816) | **Asked:** 0

### What this branch ships

`tools/check-post-body.js`, a pre-post checker for a GitHub PR/issue body FILE: it
exits 1 if the body contains any of the five em-dash spellings (Josh's absolute rule),
0 if clean, 2 on usage/read error, and prints stderr ADVICE (not a gate) when the body
carries backticks / `$(...)` / `${...}` that `gh ... --body "..."` would execute. Plus
its test (wired into `run-tests.sh` via the root `*.test.js` glob) and a plan.

**Validation note:** the canonical `validation_log_run_or_skip` helper misdetects this
npm / plain-JS repo as pnpm/TypeScript, so validation was done with the repo's real gate,
`bash tools/run-tests.sh`, green on final HEAD (all node arms pass, `✖`=0, all shell
sub-suites green; the tool's own arms run inside it, confirmed by name). The change is a
standalone tool nothing else imports, so it cannot affect other tests.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] tools/check-post-body.js — em-dash gate missed zero-padded numeric entities (`&#x02014;`, `&#08212;`, `&#0008212;`), which render as the em dash exactly (a false negative on the guard path) --> FIXED (c30ce079): patterns now `&#0*8212;` / `&#x0*2014;`, with 3 new test arms.
- [WARNING] tools/check-post-body.js — backtick advice missed `$(...)` and `${...}`, executed/expanded the same way under `--body "..."` --> FIXED (c30ce079): advice now detects and names all three forms, with a new test arm.
- [WARNING] tools/check-post-body.js — the tool is a manual pre-flight; nothing invokes it, so #1491's "nobody sweeps PR bodies" is only partly closed --> DEFERRED to follow-up card #1816: mandatory wiring (a hook running for all 18 agents, or the /create-pr flow) is a fleet-wide behaviour change, not a reversible in-lane commit; it needs its own review with an awake operator. The tool (the capability) is #1491's deliverable; #1816 owns the wiring. Documented in the plan.
- [NIT] tools/check-post-body.js:52 — source-escape pattern does not match capital `\U2014` --> DEFERRED: `\U` is not a valid em-dash-producing escape in JS/Rust/Python's short form, so no threat spelling is left uncovered.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Duplicates:** none. The reviewer independently verified BOTH directions on crafted inputs (non-em-dash Unicode dashes stay silent; uppercase/zero-padded entities fire; no-semicolon numeric refs correctly do NOT fire, matching GitHub/CommonMark rendering).
- [NIT] plan — stale absolute test counts (`3131 tests`, `10 pass 1 fail`) predating iteration 1 --> FIXED (011e1cc4): replaced with robust descriptions that cannot re-stale (per kosmos#1626).
- [NIT] test — exit-2 contract only tested the missing-file case --> FIXED (011e1cc4): added arms for directory (EISDIR), no-arg, and multiple-args, so a refactor cannot turn a usage error into a clean 0.
- [NIT] tools/check-post-body.js — `—` source-escape does not render as an em dash in a markdown BODY (displays literally), so catching it in a body is a mild false positive --> DEFERRED: kept as defense-in-depth for a body pasted from source; for Josh's ABSOLUTE rule, a rare false positive on a literal `—` is the safe direction versus a false negative.
- [NIT] tools/check-post-body.js — the gate fires on an em dash inside a fenced code block (no fence parsing) --> DEFERRED: judged design point; Josh reads the whole body including code blocks, so surfacing it is the intended, safe direction.

**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/check-post-body.js | zero-padded numeric entities missed (false negative) | FIXED | c30ce079 |
| 2 | 1 | WARNING | tools/check-post-body.js | backtick advice missed `$(...)`/`${...}` | FIXED | c30ce079 |
| 3 | 1 | WARNING | tools/check-post-body.js | tool unwired (manual only) | DEFERRED | follow-up card #1816 |
| 4 | 1 | NIT | tools/check-post-body.js:52 | capital `\U2014` not matched | DEFERRED | not a valid threat spelling |
| 5 | 2 | NIT | plan | stale absolute test counts | FIXED | 011e1cc4 |
| 6 | 2 | NIT | test | exit-2 contract under-tested | FIXED | 011e1cc4 |
| 7 | 2 | NIT | tools/check-post-body.js | `—` in a body is a mild false positive | DEFERRED | safe direction for the absolute rule |
| 8 | 2 | NIT | tools/check-post-body.js | fires on em dash in a code fence | DEFERRED | intended; Josh reads the whole body |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- capital `\U2014` (iter 1) — DEFERRED; `—` in a body (iter 2) — DEFERRED; code-fence firing (iter 2) — DEFERRED; stale plan counts + exit-2 coverage (iter 2) — FIXED.

### Strengths (from the blind passes)
- Em-dash gate correct in BOTH directions (verified on crafted inputs): non-em-dash Unicode dashes stay silent; uppercase and all zero-padded entity forms fire; no-semicolon numeric refs correctly do not, matching GitHub rendering. No rendering-equivalent spelling missed.
- One arm per spelling avoids the vacuous "first hit satisfies the assertion" trap; per-class positive controls plus a negative control (clean body passes, so a pass is not structural) and empty-stdout/stderr assertions so it is safe to chain with `&&`.
- Exit codes 0/1/2 all reachable and distinct; no error swallowed into a clean 0 (EISDIR and ENOENT both map to 2).
- Backticks handled as advice not a block (the right call: they are legitimate in a body and only dangerous with `--body "..."`; a tool that refused good input would be switched off), while an em dash still decides the exit even when backticks are present.
- Not self-refuting: every em-dash character in source/test/plan is load-bearing (a regex pattern or a fixture), never prose; prose uses `--`.
- The wiring deferral is honest and verified (nothing invokes the tool), accurately describing the shipped scope rather than overclaiming.

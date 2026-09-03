---
pre_challenge: true
method: challenge-loop
branch: report-empty-1996
diff_hash: 8f1c315a118a2005243f1f2ea99d152e04b78b18e9187a94a07c9204d7167eac
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T15:56:57Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (1 clean-baseline pass + 2 fresh blind reviews, ACROSS TWO MODELS)
**Converged:** Yes (iteration 2's only finding is a fails-safe, out-of-scope WARNING deferred with reasoning; no NEW actionable remained)
**Total findings:** 2 WARNINGs, 3 NITs (3 NITs fixed; 2 WARNINGs deferred with reasoning - both out of #1996's server-side scope and both fail safe)
**Fixed:** 3 | **Deferred:** 2 | **Asked:** 0

Server-side fix for kosmos#1996 in engine/selfreport.js: refuse a reasonless
needs_you/blocked (mirroring #2001's CLI rule: note OR --on OR --owner) and keep
paragraph breaks in the stored `because`. Plus test updates and one projects.test.js
fixture. No web/ or route change.

### Baseline (6.0)

Full engine suite green (2103 tests); the fix perturbation-verified (4 new tests go
red against the unfixed code); a projects.test.js fixture that used a reasonless
needs_you incidentally (for #763 project carry-forward) found and fixed by running
the WHOLE engine suite, not just selfreport.

### Model diversity (deliberate, per the #2007 lesson)

Iteration 1 ran on Sonnet, iteration 2 on Opus. Independent-but-identical reviewers
share blind spots; running the loop across two models is what makes "the arms agree"
mean something. Both independently confirmed the guard mirrors #2001 exactly, the
callers are safe, and the tests assert the stored value.

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
- [WARNING] a preserved `\n` in `because` is not VISIBLE in the `.dtask` detail-header surface (white-space:nowrap + ellipsis) --> DEFERRED: out of #1996's server-side scope. The store is the source of truth and the prerequisite for any render change; message surfaces already render #1927 breaks (.dm-b pre-wrap); a multi-line render of the report REASON is a web/index.html UI decision (a separate follow-up).
- [NIT] cappedSentence normalised only \r\n --> FIXED (also folds U+2028/U+2029 to \n, \v/\f to space; char-code round-trip verified).
- [NIT] K-13 test asserted only `on` stays flattened --> FIXED (added `owner`).
- [NIT] because cap asserted `<= 1000` --> FIXED (tightened to `=== 1000`; the 5000-char input guarantees truncation).

#### Iteration 2 (Opus)
- [WARNING] the server's Unicode-aware `.trim()` is stricter than #2001's CLI `tr -d '[:space:]'` on pathological input (a field of ONLY exotic whitespace, e.g. nbsp: CLI accepts, server refuses) --> DEFERRED: FAILS SAFE (the direction never inverts; the server never accepts a reasonless red the CLI would refuse; the acute silent-discard is fully closed), the server's stricter behaviour is arguably more correct (nbsp-only is visually blank), there is NO valid server-side fix (matching the CLI's looser set would be worse), and perfect symmetry is a small CLI change for #2001's owner - out of #1996's server-side scope. Flagged for #2001's owner.
**Converged** - the one finding is deferred with reasoning; no NEW actionable remained. The reviewer's STRENGTHs confirmed the core (guard mirrors #2001, `project`/`until` correctly excluded, callers safe, JSONL round-trip sound, tests assert the stored value, the control is load-bearing).

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | selfreport.js | preserved newline not visible on the .dtask nowrap surface | DEFERRED (render, out of server-side scope) |
| 2 | 1 | NIT | selfreport.js | cappedSentence folded only \r\n | FIXED |
| 3 | 1 | NIT | selfreport.test.js | only `on` asserted flattened | FIXED |
| 4 | 1 | NIT | selfreport.test.js | cap asserted `<= 1000` not `=== 1000` | FIXED |
| 5 | 2 | WARNING | selfreport.js | server trim stricter than CLI on exotic whitespace (fails safe) | DEFERRED (CLI symmetry, #2001's owner) |

### Outstanding questions (ASKED)
None.

### Deferred items (surfaced for follow-up, both out of #1996's server-side scope)
- Render: a multi-line report reason is not shown multi-line on the `.dtask` detail-header surface (web/index.html UI decision).
- CLI/server whitespace symmetry: #2001's `tr -d '[:space:]'` vs the server's Unicode trim - a small CLI change for #2001's owner; fails safe as-is.

### Strengths
- The refusal is a verified mirror of #2001 (note/on/owner), confirmed by two models against install/kosmos and cli.report-validate-2001.test.js; the load-bearing control (blocked/needs_you WITH --on/--owner but no note is ACCEPTED) locks the set.
- Tests assert the STORED value (selfreport.read), never the exit code - directly closing the silent-discard shape; empty-reason tests also assert read().found === false.
- cappedSentence keeps paragraph breaks JSONL-safely and folds every line terminator; multi-line round-trip + cap-at-exactly-1000 asserted.
- No live caller regresses (the automatic needs_you/blocked hooks always send content); the /api/report route relays the refusal cleanly as recorded:false.

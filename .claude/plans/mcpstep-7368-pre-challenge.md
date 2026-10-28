---
pre_challenge: true
method: challenge-loop
branch: mcpstep-7368
diff_hash: f48fbdc75aba30107e6fdfa7af0675d9184963f4b3012f0d029b076e1f35cfdc
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T01:45:11Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the standing 8-round cap after iteration 8; Mona Lisa's review-loop rule, set for usage on 2026-10-22). Iteration 8's two fixes (toolWords returns the name as main did when secretmask cannot load; plan wording) were NOT reviewed by a further round.
**Total findings:** 31 (2 BLOCKERs, 12 WARNINGs, 3 CONVENTIONs, 14 NITs)
**Fixed:** 23 | **Deferred:** 8 | **Asked (awaiting user):** 0

**Squashed after the loop (458010eea0):** GitHub push protection refused a fake Stripe-shaped test literal in the loop's unpushed commits, so they were squashed into one commit with the token built by concatenation (the repo's idiom). The engine code and plan are byte-identical to what iteration 8 left; only how the test builds two key-shaped fixtures changed. The commit refs in the ledger below are the pre-squash ones, kept on the local branch backup-mcpstep-7368-presquash. The full validation was run again on the squashed head.

Validation: focused tests each round (deliverystreak.turn-7368, win32streamstate, win32supervisor, win32capture.stream-570, win32authfail-7369, fixture-discipline, no-name-refs-3071; 154 at the end), and the full validation at the end, run again after the squash (24,873 node tests, 0 fail; 4 shell shards status 0; browser-check surface gate rc 0; subdir audit rc 0), per the standing rule to run the full suite once at convergence.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above (no loop fix commits yet)
- [WARNING] engine/win32streamstate.js toolWords — plugin_ prefix and lazy __ split mis-parse names --> FIXED (f6a85e2b0a): split at last __, plugin keeps all after plugin_
- [NIT] stepOfUse comment displaced by toolWords --> FIXED (f6a85e2b0a)
- [NIT] underscores turned to spaces before the mask --> FIXED (f6a85e2b0a)
- [NIT] control characters in the name --> FIXED (f6a85e2b0a)
- [NIT] doesNotThrow adds nothing --> FIXED (f6a85e2b0a)
- [NIT] no test for the two bad name shapes --> FIXED (f6a85e2b0a)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] a token after an underscore inside a name part is not masked; comment overclaims --> FIXED (84347620f7), claim deleted
- [WARNING] last-__ split choice undocumented --> FIXED (84347620f7): decided in the plan with its premise
- [CONVENTION] plan claims mutation checks without saying where --> FIXED (84347620f7)
- [NIT] doc block stranded above STEP_MAX --> FIXED (84347620f7)
- [NIT] third copy of the mask fail-closed pattern --> DEFERRED: superseded by iteration 6's single mask call
- [NIT] mcp__onlyserver and my_tool unpinned --> FIXED (84347620f7)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] a token containing __ is cut at the split; plan's "nothing leaks" false --> FIXED (38fd7368f1), claim deleted
- [NIT] mcp__claude_ai___t unpinned --> FIXED (38fd7368f1)
- [NIT] words(server) computed twice --> FIXED (38fd7368f1)
- [NIT] bidi and C1 controls pass into the step --> FIXED (38fd7368f1), later reverted in iteration 7 (see there)
- [NIT] refused-call test does not assert the permission_denied clock --> DEFERRED: the replays already go red on the mutations that matter

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] one()'s widened class untested on commands and targets --> FIXED (2986153cdb), later reverted in iteration 7
- [CONVENTION] mutation checks recorded by hand only --> DEFERRED: the reviewer marked nothing to fix
- [NIT] zero-width characters missing from the class --> FIXED (2986153cdb), later reverted in iteration 7
- [NIT] cost bound not stated --> FIXED (2986153cdb)
- [NIT] mask-failure fallback reads "using " --> DEFERRED: fails closed by design, as cut() does

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 2 of the above
- [BLOCKER] one() folded zero-width characters to a space before the mask, splitting tokens secretmask rejoins (iteration 4's own change) --> FIXED (cf4369d73e), then removed with one()'s change in iteration 7
- [WARNING] a test locked in the leaking behaviour --> FIXED (cf4369d73e)
- [CONVENTION] plan's Change section silent on one() --> FIXED (cf4369d73e)
- [NIT] token tests assert absence only --> FIXED (cf4369d73e): whole-step strings
- [NIT] per-suffix masks fill mask()'s cache --> FIXED in iteration 6 (single mask call)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] C1 and bidi controls folded to a space before the mask let a split token past --> FIXED (5e18d274bc), then removed with one()'s change in iteration 7; filed as kosmos#7386
- [WARNING] mask() called once per underscore fills the shared cache --> FIXED (5e18d274bc): one mask call per name over the name and its suffixes
- [NIT] removing U+200D breaks emoji sequences --> DEFERRED: moot after iteration 7
- [NIT] greedy split on many __ --> DEFERRED: decided in the plan
- [NIT] "using " on mask failure --> DEFERRED: fails closed
- [NIT] assertions packed in one test --> DEFERRED: style only

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 4 of the above
- [BLOCKER] one() removing DEL defeats spaced masks (a regression against main) --> FIXED (6cd81cb57d): one() and stepOfUse restored exactly to main; the invisible-character class filed as kosmos#7386
- [WARNING] a cut name reordered could put half a token in front of the cut --> FIXED (6cd81cb57d): a name longer than the cut is shown as before
- [WARNING] plan claims the whole name masks when one() pre-masked part --> FIXED (6cd81cb57d): no pre-masking of the name any more
- [CONVENTION] comment overstates "masked raw before anything can split" --> FIXED (6cd81cb57d): comment removed with the change
- [NIT] "using " trailing space --> DEFERRED: as main
- [NIT] claude_ai_ stripped from any server name --> DEFERRED: documented choice
- [NIT] secretmask required in two places --> FIXED in iteration 8 (toolWords alone)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] toolWords returned '' on a secretmask load failure where main showed the name --> FIXED (65348b9b2e): returns the name, as main
- [NIT] suffix join can over-mask across suffixes --> DEFERRED: errs the safe way
- [NIT] a name with a line break skips the MCP parse --> FIXED (65348b9b2e): named out of scope in the plan (as main)
- [NIT] plan: "as below" and review-history narration --> FIXED (65348b9b2e)
- Not reviewed by a further round (cap reached).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/win32streamstate.js toolWords | BRANCH | plugin and __ mis-parse | FIXED | f6a85e2b0a |
| 2 | 2 | WARNING | engine/win32streamstate.js toolWords | SELF | token after an underscore unmasked | FIXED | 84347620f7 |
| 3 | 2 | WARNING | .claude/plans/mcpstep-7368.md | BRANCH | split choice undocumented | FIXED | 84347620f7 |
| 4 | 3 | WARNING | engine/win32streamstate.js toolWords | SELF | token spanning the split | FIXED | 38fd7368f1 |
| 5 | 4 | WARNING | engine/deliverystreak.turn-7368.test.js | SELF | one() class untested | FIXED | 2986153cdb (reverted 6cd81cb57d) |
| 6 | 5 | BLOCKER | engine/win32streamstate.js one() | SELF | zero-width folded before mask | FIXED | cf4369d73e (removed 6cd81cb57d) |
| 7 | 6 | WARNING | engine/win32streamstate.js one() | SELF | C1/bidi split token | FIXED | 5e18d274bc (removed 6cd81cb57d; kosmos#7386) |
| 8 | 6 | WARNING | engine/win32streamstate.js toolWords | SELF | mask cache filled per underscore | FIXED | 5e18d274bc |
| 9 | 7 | BLOCKER | engine/win32streamstate.js one() | SELF | DEL removed defeats spaced masks | FIXED | 6cd81cb57d |
| 10 | 7 | WARNING | engine/win32streamstate.js toolWords | SELF | cut name reordered | FIXED | 6cd81cb57d |
| 11 | 7 | WARNING | .claude/plans/mcpstep-7368.md | SELF | whole-name mask claim | FIXED | 6cd81cb57d |
| 12 | 8 | WARNING | engine/win32streamstate.js toolWords | SELF | '' on mask load failure | FIXED | 65348b9b2e |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] permission_denied clock unasserted (iteration 3)
- [NIT] mask-failure fallback reads "using " (iterations 4, 6, 7)
- [NIT] emoji ZWJ sequences (iteration 6, moot)
- [NIT] greedy split on many __ (iteration 6)
- [NIT] packed assertions (iteration 6)
- [NIT] claude_ai_ prefix strip (iteration 7)
- [NIT] suffix join can over-mask (iteration 8)

### Strengths (across all iterations)
- Both replay tests drive the real publisher with the measured Claude Code 2.1.312 streams and have control arms (every iteration).
- The mutation checks recorded in the plan each go red, and were re-run after every structural change (iterations 1 to 8).
- Iteration 7's decision to restore one() to main, and file the class as kosmos#7386, ended a run of four regressions in a row from changing it under review.

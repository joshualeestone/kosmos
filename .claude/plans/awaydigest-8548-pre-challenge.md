---
pre_challenge: true
method: challenge-loop
branch: awaydigest-8548
diff_hash: a910eeb40245c93f7d97850e368e1149a53a96ca7658536dc8a4f8bb179fa8b0
validation: passed
subdir_audit: passed
timestamp: 2026-11-15T05:57:00Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (ended at the fleet's 8-round cap, Splinter's standing rule of 10-22 restated 10-26: past round 8 only an open BLOCKER continues; round 8 raised no BLOCKER and both its WARNINGs were fixed)
**Total findings:** 51 (2 BLOCKERs, 29 WARNINGs, 3 CONVENTIONs, 17 NITs)
**Fixed:** 30 actionable | **Deferred:** 2 | **Asked (awaiting user):** 0

Initial validation (6.0) was run as focused suites (59 then 65 related files, 0 failures) and the full detached validation ran at the end (6j): first run 1 red (engine/windows-tests-1777, the new Mac CLI test not listed for the Windows run), fixed in e3e36cbdaf, second run PASSED on that HEAD (29145 tests, 0 fail; build passed; hash a910eeb40245).

Self-generated (6c-bis): the blame lookup was NOT run this loop, so every Origin is recorded BRANCH (the fail-safe value) and every per-iteration Self-generated count reads "not classified".

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** not classified
- [WARNING] engine/awaydigest.js - posts placed or quiet counted as missed --> FIXED (35dea390a3: count only could_not)
- [WARNING] engine/awaydigest.js - mention rule ignored `addressed` --> FIXED (35dea390a3: messages.namedIn)
- [WARNING] engine/awaydigest.js - refused rows are deduplicated; fixtures used unlogged shapes --> FIXED (35dea390a3)
- [WARNING] engine/awaydigest.js - inbox default limit 10 --> FIXED (35dea390a3: --limit 50)
- [WARNING] engine/kosmos-report-hook.js - Windows supervisor --resume gets no digest, unstated --> FIXED (35dea390a3: stated in plan and hook)
- [WARNING] plan - weakest premise claimed "never less" --> FIXED (35dea390a3)
- [WARNING] install/kosmos - kosmos away untested on both CLIs --> FIXED (35dea390a3: cli.away-8548, tools.windows-kosmos-cli-away-8548)
- [CONVENTION] plan - pieces named POST /api/away/take --> FIXED (35dea390a3)
- [NIT] install/kosmos help column; [NIT] backstop timing comment --> FIXED (35dea390a3); [NIT] empty from_pane on Windows (as the sibling)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not classified
- [WARNING] engine/awaydigest.js - sender names printed unfiltered (outside names) --> FIXED (73ba9098f9: TOKEN_RE)
- [WARNING] server.js - 4 MB history read on every startup --> FIXED (73ba9098f9: default tail at startup)
- [WARNING] server.js - truncated record read as "no earlier report" --> FIXED (73ba9098f9)
- [NIT] DM filter vs inbox --> FIXED (73ba9098f9); [NIT] second rounding; [NIT] --hook silent by hand (intended)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** not classified
- [WARNING] engine/awaydigest.js - inbox --since lists the OLDEST 50 --> FIXED (bd7e3f5faa)
- [WARNING] engine/awaydigest.js - message rows are typed or held for a running pane --> FIXED (bd7e3f5faa: only refusals count)
- [WARNING] install/kosmos-report-hook.sh - Mac time budget unstated --> FIXED (bd7e3f5faa: measured, guarded)
- [CONVENTION] hook header table missing the digest --> FIXED (bd7e3f5faa)
- [NIT] person session asks needlessly --> FIXED; [NIT] fixture states --> FIXED; [NIT] DMs without text --> FIXED (bd7e3f5faa)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not classified
- [WARNING] engine/awaydigest.js - refusals of every reason counted --> FIXED (7b48e0eaa5: worded "for any reason")
- [WARNING] engine/awaydigest.js - header claimed "while not running" across the window edge --> FIXED (7b48e0eaa5: "since it last heard from this agent")
- [WARNING] engine/kosmos-report-hook.js - Windows asked with no token --> FIXED (7b48e0eaa5)
- [NIT] from_pane empty; [NIT] CLI start uncapped --> FIXED (comment, 7b48e0eaa5)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not classified
- [BLOCKER] server.headers-twice-7686.test.js - fourth fail closure breaks a source-reading test --> FIXED (ede12922bf)
- [BLOCKER] engine/kosmos-report-hook.js - Windows refused before started after an absence (no roster row, stale heartbeat) --> FIXED (ede12922bf: asks after a recorded started, by-hand window)
- [WARNING] engine/awaydigest.js - `quiet` misdescribed --> FIXED (ede12922bf)
- [WARNING] engine/awaydigest.js - DMs counted regardless of delivery --> FIXED (ede12922bf)
- [WARNING] engine/kosmos-report-hook.js - pane-only ask always refused --> FIXED (ede12922bf: token only)
- [NIT] indentation --> DEFERRED (matches the pre-existing lines it sits beside); [NIT] bad room ids dropped (stated); [NIT] boundary

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not classified
- [WARNING] engine/awaydigest.js - refusals not filtered to not-running reasons --> DEFERRED: a filter would copy the refusal sentences (a second matcher that drifts); the line says "for any reason"; stated in the plan
- [WARNING] engine/awaydigest.js - boundary and held DMs --> FIXED (93cf5112e6)
- [NIT] false test comment; [NIT] 12 s unsourced; [NIT] truncated window unstated --> FIXED (93cf5112e6)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not classified
- [WARNING] engine/awaydigest.js - refusal `to` is the name as typed (case) --> FIXED (8c056ad85f)
- [WARNING] plan - said held DMs count --> FIXED (8c056ad85f)
- [NIT] duplicate DM copies; [NIT] world-1704 comment; [NIT] Windows usage line; [NIT] 4 MB read on the Windows hook --> FIXED (8c056ad85f)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not classified
- [WARNING] server.js - unreadable records answered "Nothing arrived" --> FIXED (dfa497dd07)
- [WARNING] plan - Mac pre-started identity reasoned, not stated --> FIXED (dfa497dd07)
- [NIT] board token sent beside the agent token (as siblings); [NIT] refusals while running (stated); [NIT] CLI start time (stated)

#### Final validation (6j)
- [BLOCKER] final-validation: engine/windows-tests-1777 (cli.away-8548.test.js not run on Windows nor excluded) --> FIXED (e3e36cbdaf); re-run PASSED on e3e36cbdaf

### Final Ledger (actionable findings)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/awaydigest.js | BRANCH | placed/quiet posts counted | FIXED | 35dea390a3 |
| 2 | 1 | WARNING | engine/awaydigest.js | BRANCH | addressed ignored | FIXED | 35dea390a3 |
| 3 | 1 | WARNING | engine/awaydigest.js | BRANCH | refusal dedup, fixtures | FIXED | 35dea390a3 |
| 4 | 1 | WARNING | engine/awaydigest.js | BRANCH | inbox limit | FIXED | 35dea390a3 |
| 5 | 1 | WARNING | engine/kosmos-report-hook.js | BRANCH | Windows resume unstated | FIXED | 35dea390a3 |
| 6 | 1 | WARNING | plan | BRANCH | weakest premise | FIXED | 35dea390a3 |
| 7 | 1 | WARNING | install/kosmos | BRANCH | CLI untested | FIXED | 35dea390a3 |
| 8 | 1 | CONVENTION | plan | BRANCH | route name | FIXED | 35dea390a3 |
| 9 | 2 | WARNING | engine/awaydigest.js | BRANCH | unfiltered names | FIXED | 73ba9098f9 |
| 10 | 2 | WARNING | server.js | BRANCH | 4 MB read | FIXED | 73ba9098f9 |
| 11 | 2 | WARNING | server.js | BRANCH | truncated record | FIXED | 73ba9098f9 |
| 12 | 3 | WARNING | engine/awaydigest.js | BRANCH | oldest 50 | FIXED | bd7e3f5faa |
| 13 | 3 | WARNING | engine/awaydigest.js | BRANCH | message rows | FIXED | bd7e3f5faa |
| 14 | 3 | WARNING | install/kosmos-report-hook.sh | BRANCH | time budget | FIXED | bd7e3f5faa |
| 15 | 3 | CONVENTION | install/kosmos-report-hook.sh | BRANCH | header table | FIXED | bd7e3f5faa |
| 16 | 4 | WARNING | engine/awaydigest.js | BRANCH | refusal reasons | FIXED | 7b48e0eaa5 |
| 17 | 4 | WARNING | engine/awaydigest.js | BRANCH | header claim | FIXED | 7b48e0eaa5 |
| 18 | 4 | WARNING | engine/kosmos-report-hook.js | BRANCH | no-token ask | FIXED | 7b48e0eaa5 |
| 19 | 5 | BLOCKER | server.headers-twice-7686.test.js | BRANCH | closure count | FIXED | ede12922bf |
| 20 | 5 | BLOCKER | engine/kosmos-report-hook.js | BRANCH | Windows refused pre-started | FIXED | ede12922bf |
| 21 | 5 | WARNING | engine/awaydigest.js | BRANCH | quiet wording | FIXED | ede12922bf |
| 22 | 5 | WARNING | engine/awaydigest.js | BRANCH | DM delivery | FIXED | ede12922bf |
| 23 | 5 | WARNING | engine/kosmos-report-hook.js | BRANCH | pane-only ask | FIXED | ede12922bf |
| 24 | 6 | WARNING | engine/awaydigest.js | BRANCH | refusal reason filter | DEFERRED | second matcher would drift; worded "for any reason" |
| 25 | 6 | WARNING | engine/awaydigest.js | BRANCH | boundary, held DMs | FIXED | 93cf5112e6 |
| 26 | 7 | WARNING | engine/awaydigest.js | BRANCH | case of `to` | FIXED | 8c056ad85f |
| 27 | 7 | WARNING | plan | BRANCH | held DMs | FIXED | 8c056ad85f |
| 28 | 8 | WARNING | server.js | BRANCH | unreadable records | FIXED | dfa497dd07 |
| 29 | 8 | WARNING | plan | BRANCH | Mac ordering reasoned | FIXED | dfa497dd07 |
| 30 | 6j | BLOCKER | tools/windows-tests.js | BRANCH | Windows run listing | FIXED | e3e36cbdaf |
| 31 | 5 | NIT | install/kosmos-report-hook.sh | BRANCH | indentation | DEFERRED | matches the pre-existing lines beside it |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- Windows takeAway sends an empty from_pane and the board token when present (iterations 1, 8; matches takeFileNotices)
- Bad room ids are dropped from the count, not only unnamed (iteration 5; stated in the file header)
- kosmos away --hook by hand is silent on failure (iteration 2; intended, the usage says so)

### Strengths (across all iterations)
- Only counts, plain-token ids and names reach the model; a test injects a hostile sender name (iterations 1-8)
- Identity resolved as /api/file-notices/take, no agent parameter, with an enforcing-board control (iterations 1, 3, 7)
- One JSON object on stdout in both hooks, with order and failure arms tested and mutant-checked (iterations 1, 3, 8)

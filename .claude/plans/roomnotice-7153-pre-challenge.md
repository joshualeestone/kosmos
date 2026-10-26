---
pre_challenge: true
method: challenge-loop
branch: roomnotice-7153
diff_hash: dbc494310dcd9ed88d63a9d59f3959e0908d44089926ac5a716bcd7869d9f285
validation: passed (focused: every test reading install/kosmos or server.js plus all cli.* and tools.windows* tests, 202 files, 2778 tests, 0 failed, 49 skipped, last run after iteration 8; the six notice-related files 89/89 after iteration 9; CI runs the full suite)
subdir_audit: passed (no subdir CLAUDE.md touched)
timestamp: 2026-10-25T23:25:57Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes
**Total findings:** 72 (3 BLOCKERs, 27 WARNINGs, 1 CONVENTION, 41 NITs)
**Fixed:** 50 | **Deferred:** 9 | **Asked (awaiting user):** 0

Mutant runs recorded in the session: removing the whitespace flattening fails the forged-row test; removing the gate
refusal is caught by the agent-token CONTROL (which first proves the token works on the member's own room).

Self-generated column: not measured by blame this run; Origin recorded as BRANCH throughout (the fail-safe value).
Several later findings were in the loop's own earlier fixes (the 64 KB pre-check of iteration 8 was removed in
iteration 9 as its premise was false).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
- [BLOCKER] a notice with a line break forged a separate row in `kosmos room`'s text view --> FIXED (flatten at write; forged-row test; 655e62bd4a)
- [WARNING] source check narrower than its rule --> FIXED (allow-list regex)
- [WARNING] Mac CLI built broken JSON for odd sources; non-JSON answered as "needs words" --> FIXED (CLI check; distinct error)
- [WARNING] Windows silently retargeted a misspelled project --> FIXED (refused)
- [WARNING] agent-token refusal had no positive control --> FIXED
- [NIT] comment placement, `notice --help`, code-point counting --> FIXED; tabs/keep-copy parity --> fixed in iteration 2

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] outside words in Kosmos's voice --> FIXED ("(automated notice)" mark; fleet instructions say it is information) and recorded as residual
- [WARNING] failed notice lost --> FIXED (kept copy on the Mac)
- [NIT] control/bidi characters, astral limit test, old-board 404 wording --> FIXED; per-route projects.json side effect --> DEFERRED (matches siblings)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 4 NITs
- [BLOCKER] Windows help printed "kosmos notice undefined" (no DESCRIBE entry; help rows must match) --> FIXED (shared wording; cli.help-lines-4785 green)
- [WARNING] Windows never kept a failed notice --> FIXED
- [WARNING] Mac esc_text failure path did not keep --> FIXED
- [CONVENTION] dynamic-scope globals from _read_piped_message --> FIXED (local)
- [NIT] newline in source, \p{Cf}, comment, plan condition --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] instruction to agents that notices are data --> FIXED (fleet instructions, outside this repo)
- [WARNING] Windows timeout wording; Mac 28 not "maybe" --> FIXED
- [WARNING] board-down keep untested on both platforms --> FIXED (tests)
- [NIT] INVISIBLE set, assertion wording --> FIXED; rate cap --> DEFERRED (recorded residual)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] Windows cut answer reported "not sent" --> FIXED (maybe, exit 3)
- [WARNING] Mac maybe outcomes exited 1 (a retrying job would double-post) --> FIXED (exit 3)
- [WARNING] setup mistakes lost the text --> FIXED (read first, then validate)
- [WARNING] agents could use the verb --> FIXED (tripwire, documented as not a lock)
- [NIT] usage string, dead branch, comment, Windows board-token assert --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] tripwire before the read lost text --> FIXED (after the read, kept)
- [WARNING] tripwire refused any tmux pane --> FIXED (_invoked_by_agent, fake-tmux control)
- [WARNING] curl 55 classification --> DEFERRED (documented: not written whole)
- [NIT] require hoist, plan wording --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
- [WARNING] over-limit digest exited 1 (retry forever) --> FIXED (400 exits 2; limit in usage)
- [NIT] dot-only project, Windows notConnected, pinned 404 wording, plan wording --> FIXED; Windows refusedBy --> DEFERRED (no agent token involved)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] huge pipe escaped before refusal --> FIXED by a pre-check, later REMOVED in iteration 9 (premise false)
- [WARNING] job from inside an agent's pane refused with exit 2 --> DEFERRED (misuse, text kept; recorded)
- [NIT] server length bound, plan figures --> FIXED

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
- [WARNING] the 64 KB pre-check's premise is false for whitespace-heavy text and Windows had none --> FIXED (pre-check removed)
- [NIT] usage wording, separate empty/too-long refusals, test title, pinned exit codes, plan sentence --> FIXED; sed of an escaped quote --> DEFERRED (unreachable: the CLI checks the source first)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after deduplication, 0 CONVENTIONs; 3 NITs
- [WARNING] Windows unknown unreached shape treated as "may" --> DEFERRED: the conservative side for an alarm (never a double post, text kept), recorded in the plan
- [NIT] format-character side effects --> recorded in the plan as a decided trade-off; sed join speed and curl 55 --> already recorded
**Converged** - no new actionable findings.

### Strengths (across all iterations)
- Authorization rides the existing board-token gate; the route is off every agent-token list, proven with a control
- A notice is a roomNote (from kosmos, validated by rowShaped), flattened to one line with control, format, bidi and invisible characters removed, marked "(automated notice)", source in plain words
- Both CLIs read first and keep the text on every later failure, and map outcomes to exit codes a retrying job can trust (1 not written, 2 refused, 3 maybe)

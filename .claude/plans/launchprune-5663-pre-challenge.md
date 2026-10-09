---
pre_challenge: true
method: challenge-loop
branch: launchprune-5663
diff_hash: f8e82266775113bdac30f4ac0ccafb60742887509aebcd4e321f463ab0af5a06
validation: passed (Mortals full suite at 1f11ff040, hash f8e822667751)
subdir_audit: passed
timestamp: 2026-10-09T11:10:12Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20, each a fresh blind reviewer, alternating Opus (odd rounds) and Sonnet (even rounds).

**Converged:** Yes, at iteration 20 (Sonnet). Every warning and convention finding in that round repeated a point already fixed or decided:
- the size warning reaching only the log is carded as #5668;
- the brief upgrade window;
- the use-strict guard needing a git checkout;
- the review-number comment style;
- the plan file name.

Its nits were correct as written, or readability only.

**Findings:** every BLOCKER and WARNING was fixed or decided with a written reason in the plan's review log. The main fixes by round:
- **review 1:** pruning depended on the caller;
- **review 3:** code had gone above 'use strict' (now with a repo-wide class guard);
- **review 4:** the ceiling refused agent creation (now a warning);
- **review 7:** a board start's absent-on-purpose denies were pruned by a launch;
- **review 9:** the unstable tmux PATH (only paths that exist are recorded);
- **review 11:** a non-ENOENT read error forgot the record;
- **review 14:** an inherited env var made a board start a launch;
- **review 15:** a board start wrote the record over a launch's;
- **review 17:** the log claimed a copy that was never written.

**Measured:** Claude Code puts the Edit and Read deny rules into the sandbox profile (claude -p with the sandbox on). The compiled-profile limit (65,535 bytes) and the command-line limit (E2BIG) were measured on eight sets, and the ceilings are fitted under them with a margin.

**Validation:**
- engine/launchprune-5663.test.js (23 tests) and engine/use-strict-first-5663.test.js, plus the related guard suites (30 files, 837 pass) on the merged tree.
- Each fix's mutation made a test fail.
- The browser-check surface gate passes.
- The full suite ran on Mortals at the head named above. The first run, at 4c7ebd0a3, failed one test: comment-deferral (#147), because my code comment handed work to a card number. The comment was reworded to name the open card, with no behaviour change, and the second run is the one named.

## Ledger (iteration by iteration)

# launchprune-5663 ledger
#### Iteration 1 (Opus) at 25236590a
- [BLOCKER] (R1-B1) BLOCKER pruning caller-dependent (board start has no pane PATH, prunes launch rules): FIXED 1210dc164 (prune only gone path + gone parent; union record)
- [WARNING] (R1-W1) scan failure prunes everything: FIXED (prune needs path gone on disk)
- [WARNING] (R1-W2) ceiling counts only sandbox lists: FIXED + MEASURED (Edit/Read deny rules reach the profile; prefix + raw limits)
- [WARNING] (R1-W3) ceiling test does not pin threshold: FIXED (exact boundary per arm, value asserted)
- [WARNING] (R1-W4) test 2 does not assert second call: FIXED
- [WARNING] (R1-W5) no tests for corrupt record / narrower launch set: FIXED
- [NIT] (R1-N1) redundant filter: n/a after rewrite
- [NIT] (R1-N2) temp file left on rename failure: FIXED
- [NIT] (R1-N3) silent skip of record rule: DEFERRED (record write failure is said on stderr; the rule is always pushed)
- [NIT] (R1-N4) raw-path comparison: DEFERRED (record stores what the guard wrote, already resolved)
#### Iteration 2 (Sonnet) at 1210dc164
- [WARNING] (R2-W1)/W2 vacuous sandbox asserts (realOr after rm): FIXED fbe376405 (capture before, control present, no spelling left)
- [WARNING] (R2-W3) unmounted volume pruned by board start: FIXED (only a launch, paneKnown, prunes)
- [WARNING] (R2-W4) ceiling reason hides launchUnsafe: FIXED (both said)
- [WARNING] (R2-W5) ceiling off macOS on existing sandbox key: FIXED (darwin only)
- [WARNING] (R2-W6) lock-free record, comment overclaims: FIXED comment + DECIDED in plan (safe direction)
- [CONVENTION] (R2-C1) block split doc comment: FIXED (moved)
- [CONVENTION] (R2-C2) plan filename lacks timestamp: DEFERRED (PR hook requires <branch>.md)
- [CONVENTION] (R2-C3) plan Built/Decided stale: FIXED
- [NIT] (R2-N1) assert no spelling of old folder: FIXED
- [NIT] (R2-N2) ruleTarget comment: FIXED
#### Iteration 3 (Opus) at fbe376405
- [WARNING] (R3-W1) #5663 block above 'use strict' (module sloppy): FIXED + CLASS GUARD engine/use-strict-first-5663.test.js (1,902 files pass; red on mutation)
- [WARNING] (R3-W2) version FILE in a folder that stays never pruned: FIXED (parent condition dropped; launch gate covers the unmount case); test added
- [NIT] (R3-N1) comment detached from sz check: FIXED
- [NIT] (R3-N2) record rule skipped silently: FIXED (stderr)
- [NIT] (R3-N3) includes() quadratic: FIXED (Set)
#### Iteration 4 (Sonnet) at 31c21dd4e
- [WARNING] (R4-W1) ceiling ok:false refuses creation on an estimate: FIXED (ok:true + warning + stderr), DECIDED in plan
- [WARNING] (R4-W2) record rule with pattern char silently skipped: FIXED (tokenRuleDropped)
- [NIT] (R4-N1) use-strict detector single quote + semicolon only: FIXED
- [NIT] (R4-N2) tmp glob counted literally: DEFERRED (overcount, safe direction)
#### Iteration 5 (Opus) at 7385c8bb9
- [WARNING] (R5-W1) legacy unrecorded launch rules never pruned: DECIDED (bounded claim; launch rules only since #5660 03:03; no migration)
- [WARNING] (R5-W2) cross-list dedup undercounts: FIXED (per clause)
- [NIT] (R5-N1) no env-var launch test: FIXED
- [NIT] (R5-N2) warning only on stderr: DEFERRED (decided R4)
- [NIT] (R5-N3) use-strict misses trailing comment: FIXED
- [NIT] (R5-N4) dangling link comment: FIXED
#### Iteration 6 (Sonnet) at a2b4a6045
- [WARNING] (R6-W1) warning only on stderr: DUPLICATE of R4/R5-N2 (decided); doc comment names readers
- [WARNING] (R6-W2) comment overclaims "person's own untouched": FIXED
- [NIT] (R6-N1) legacy unrecorded rules: DUPLICATE of R5-W1
- [NIT] (R6-N2) shared temp name in one process: FIXED (random suffix)
- [NIT] (R6-N3) inline directive: DEFERRED (guard covers the found class)
- [CONVENTION] (R6-C1) review markers: matches file style, no action
#### Iteration 7 (Opus) at 75095005c
- [WARNING] (R7-W1) board start records its own-input launch rules; a launch prunes deliberate absent-path denies: FIXED (only a launch records); test + 2 mutations red
- [WARNING] (R7-W2) no asymmetric-input test: FIXED
- [NIT] (R7-N1) use-strict false red on template literal: DEFERRED (none exists; indented directives not matched)
- [NIT] (R7-N2) record written after cleanLocalSettings: FIXED
- [NIT] (R7-N3) settings tmp name: DEFERRED (pre-existing #4491 code, not this card)
#### Iteration 8 (Sonnet) at 9957bb8de
- [WARNING] (R8-W1) empty pane PATH counts as launch inputs, prunes: FIXED (needs an absolute entry); test, old gate red
- [WARNING] (R8-W2) upgrade window prunes a momentarily-absent path: DECIDED (plan; one-session exposure, re-added when current)
- [WARNING] (R8-W3) warning repeats in board log: DECIDED
- [CONVENTION] (R8-C1) Where to Find Things row: DECLINED (nothing moved; guard has no row)
- [CONVENTION] (R8-C2) use-strict guard in this PR: DECIDED keep; false-red shape named in header (dup of R7-N1)
- [NIT] (R8-N1) inline require: FIXED
- [NIT] (R8-N2) fitted label: FIXED
- [NIT] (R8-N3) plan name: DUPLICATE
#### Iteration 9 (Opus) at 592e4d00d
- [WARNING] (R9-W1) absent-on-purpose launch paths pruned when tmux global PATH changes: FIXED (record only existing paths); test + 2 mutations red
- [NIT] (R9-N1) record Edit rule unresolved spelling: DEFERRED (matches existing rules; sandbox folder deny protects)
- [NIT] (R9-N2) plan premise overclaims: FIXED
#### Iteration 10 (Sonnet) at ba6f99a15
- [WARNING] (R10-W1) warning only in logs: DUPLICATE (R4/5/6) -> carded #5668
- [WARNING] (R10-W2) same-string person rule; recreated mid-session: DUPLICATES (R6, R8-W2)
- [WARNING] (R10-W3) corrupt record overwritten, entries forgotten: FIXED (dated copy + stderr); test, mutation red
- [WARNING] (R10-W4) existing installs not cleaned: DUPLICATE (R5-W1)
- [NIT] (R10-N1) lock-free: DUPLICATE; N2 lstat correct: no action
- [NIT] (R10-N3) use-strict git dependency: DEFERRED; N4 1400 dirs: DEFERRED; C1 review numbers: file style
#### Iteration 11 (Opus) at 3c0b41065
- [WARNING] (R11-W1) size undercounts (~/ spellings, user-level files): FIXED ~/ ; claim narrowed; user-level -> #5668
- [WARNING] (R11-W2) non-ENOENT read errors forget the record: FIXED (log, keep, no write); test, 2 mutations red
- [CONVENTION] (R11-C1) doc comment lacks warning: FIXED
- [NIT] (R11-N1) plan heading: FIXED; N2 repeated copies: FIXED (one per content); N3 use-strict parser: DEFERRED
#### Iteration 12 (Sonnet) at 57a9a07d8
- [WARNING] (R12-W1) post-prune window (gone then back on PATH): DECIDED, stated in plan (inherent; cf R8-W2)
- [WARNING] (R12-W2) silent drop of a pruned rule: FIXED (count logged); test, mutation red
- [WARNING] (R12-W3) lock: DUPLICATE; W4 warning visibility: DUPLICATE (#5668)
- [CONVENTION] (R12-C1) use-strict scope/git: DUPLICATE
- [NIT] (R12-N1) other spellings: DUPLICATE (R11); N2 root mode-000: FIXED; N3 review tags: style
#### Iteration 13 (Opus) at 70585c274
- [WARNING] (R13-W1) two derivations of path existence: FIXED (launchPathState present|gone|unknown); EACCES test, 3 mutations red
- [CONVENTION] (R13-C1) ruleTarget duplicates rulePath: FIXED
- [CONVENTION] (R13-C2) plan name: DUPLICATE; C3 commit subjects: DECIDED (squash takes PR title)
- [NIT] (R13-N1) block-comment false red: FIXED (header); N2 size before bytes: FIXED; N3 local helpers: test pattern
#### Iteration 14 (Sonnet) at da097def7
- [WARNING] (R14-W1) board start inheriting KOSMOS_GUARD_PANE_PATH counts as launch: FIXED (atLaunch required); 2 tests incl. end-to-end through refreshTokenOnlyGuards; 2 mutations red
- [WARNING] (R14-W2) warning only in log: DUPLICATE (#5668)
- [NIT] (R14-N1) platform in size count: FIXED; N2 dated copies never removed: DUPLICATE-ish, bounded
#### Iteration 15 (Opus) at 0b5068f75
- [WARNING] (R15-W1) board start writes record over concurrent launch entries: FIXED (only a launch writes); test, mutation red
- [WARNING] (R15-W2) settings.json board-vs-launch race keeps a pruned rule: DECIDED (safe, stated)
- [NIT] (R15-N1) platform in prune/record: FIXED; N2 "denies whole" comment: FIXED; N3 spelling note: FIXED; N4 use-strict: DUPLICATE
- [CONVENTION] (R15-C1) first commit body stale: DECIDED (squash takes PR body)
#### Iteration 16 (Sonnet) at a8390501c
- [WARNING] (R16-W1) legacy rules (DUPLICATE R5) + new: plan's "bounded to one version per tool" unmeasured: FIXED (plan wording)
- [WARNING] (R16-W2) lock: DUPLICATE; W3 warning: DUPLICATE (#5668)
- [CONVENTION] (R16-C1) review tags: DUPLICATE (style); C2 long lines: style; C3 plan name: DUPLICATE
- [NIT] (R16-N1) hash name for copies: DEFERRED (corrupt-only path); N2 none
#### Iteration 17 (Opus) at e59328148
- [WARNING] (R17-W1) copy-write failure logged as a copy, record overwritten: FIXED (keep, honest log); test, mutation red
- [NIT] (R17-N1) warning counts entries not paths: FIXED (wording); N2 use-strict deleted file: FIXED; N3 kept-old-version tools: FIXED (plan); N4 helper pair: FIXED
#### Iteration 18 (Sonnet) at 45654058c
- [WARNING] (R18-W2) board start reads/copies/logs corrupt record each start: FIXED (only a launch reads); test, mutation red
- [WARNING] (R18-W1) post-prune window: DUPLICATE (R12); N1 copies: DUPLICATE; N2 use-strict scope: DUPLICATE; N3 overcount: DUPLICATE; C1: DUPLICATE
#### Iteration 19 (Opus) at 9151bd2ee
- [WARNING] (R19-W1) post-prune risk understated (any recorded path): DUPLICATE of R12 with wording FIXED
- [CONVENTION] (R19-C1) commit subjects: DUPLICATE (PR title #5663:); C2 plan-name conflict: DECIDED (org setup, not this lane); C3 review tags: DUPLICATE
- [NIT] (R19-N1) copy not byte-exact: FIXED; test, mutation red
- [NIT] (R19-N2) two ~/ parsers: FIXED (ruleTarget home); N3 guard location: DEFERRED
#### Iteration 20 (Sonnet) at 1710ee723: ZERO NEW -> CONVERGED
- [WARNING] (R20-W1) record-write failure only on stderr: DUPLICATE (R4/R5/R6/R10 class, #5668)
- [WARNING] (R20-W2) lstat-instant upgrade window: DUPLICATE (R8-W2, R12, R19)
- [WARNING] (R20-W3) use-strict needs a git checkout: DUPLICATE (R10-N3, deferred: tests run from a checkout)
- [CONVENTION] (R20-C1) review-number comments: DUPLICATE; C2 plan name: DUPLICATE
- [NIT] (R20-N1) home: consistent (not an issue); N2 extract helper: readability nit, not taken; N3 repeated warning: DUPLICATE (R8-W3)
## After convergence: full suite on Mortals at 4c7ebd0a3 FAILED (1 test)
- comment-deferral.test.js (#147): my comment "#5668 carries that" assigns work to a number. Reworded to name the open card (no behaviour change). The guard passes; it was red on the old wording. Full suite re-queued.

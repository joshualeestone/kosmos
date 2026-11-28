---
pre_challenge: true
method: challenge-loop
branch: wing5srv-8378
diff_hash: d5179686163b744f5e0c920f49bed7d7cfe0681db4c9c169bc1de71637091142
validation: passed
subdir_audit: passed
timestamp: 2026-11-28T09:36:00Z
iterations: 7
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** No. Every round found WARNINGs or NITs. It stopped after round 7 with no BLOCKER found in any round, and
every WARNING was fixed or answered. Splinter's usage rule (Fleet Builders m510) allows 8. Round 7's findings were stale
plan lines, a conflict with main (since rebased) and a coordination note, so an eighth round was not run.
**Total findings:** 0 BLOCKERs, 20 WARNINGs and 29 NITs over 7 rounds.
- WARNINGs by round: 4, 3, 3, 3, 3, 1, 3.
- NITs by round: 6, 3, 6, 2, 6, 2, 4.
**Fixed:** every WARNING but those answered by statement in the ledger | **Deferred:** NITs listed per round | **Asked:** 0

Measured on GitHub's Windows runner, through the never-merged branch wing5srv-8378-never-merge:
- The baseline: 58 of 59 files failed, 126 tests (run 46119265069).
- The rebased head (run 46124895233): 60 files, 465 pass, 25 skip, 0 fail.

Mutations of the new helper test went red on each install call into engine/status, both factory patches, reset, and
both halves of fleet.restore.

**Closing validation.** Full validation of 5df74d5425 passed: 32017 node tests, 0 failures, rc 0, audit rc 0, clean tree, head unchanged. Main then moved 18 commits; one touched tools/windows-tests.js outside this branch's entries (its ALSO list). The branch was rebased onto it cleanly (merge-tree clean). After the rebase every file but tools/windows-tests.js is byte-identical to the validated head, the file has no key twice, engine/windows-tests-1777 and the helper test pass (30/30), and the final Mac run of the 61 files (514 tests, 0 fail) and the Windows run of the 60 (465 pass, 25 skip, 0 fail) were on the validated tree. While the PR waited, main took four more Windows changes to tools/windows-tests.js (#9291, #9293, #9295, #9298); the branch was rebased again (05:1x CST, 11-28), the file merged once from its final states (212 + 9 + 15 = 236 entries, none twice), every other file byte-identical, the guard and helper test 30/30.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] compat-hidden skipped its whole OFF arm, which exists on Windows --> FIXED (250c33c84b)
- [WARNING] the #9279 skip reasons called the setup unbuildable, not a fail-open bug --> FIXED (250c33c84b)
- [WARNING] nothing keeps these files green on Windows --> ANSWERED (card #9286)
- [WARNING] the board child is only half switched to the fixture --> FIXED (250c33c84b, documented)
- [NIT] three FIXED (link Windows arm, header claims, plan order), three not taken

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] remote-bind's entry said the file never ran on Windows --> FIXED (f4450243e3)
- [WARNING] builtfiles' entry missed its two left-out CLI reads --> FIXED (f4450243e3)
- [WARNING] compat-hidden's OFF arm on Windows cannot show the add gate --> FIXED (f4450243e3, said in comment and entry)
- [NIT] three not taken (product gaps refused by design, each with a Windows arm)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 (WARNING 1: my header implied the Windows board was tested)
- [WARNING] on Windows every card is a Mac card; a green proves reachability only --> FIXED (0889e5dd88; header, plan, #9262 told)
- [WARNING] three ways to do one thing (two older shims on main) --> ANSWERED (0889e5dd88, named in the header)
- [WARNING] seams can be lost silently; descriptor tests pass checking nothing --> FIXED (0889e5dd88; attachment-range skip under #9276)
- [NIT] two FIXED (update-pause comment, a pinning test), four not taken

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (my new test left the engine wiring unpinned)
- [WARNING] the helper's install into engine/status was not pinned --> FIXED (d9f5c03541, spies)
- [WARNING] the preload logic never ran in a test --> FIXED (d9f5c03541, installForChild)
- [WARNING] the test left the helper's state set --> FIXED (d9f5c03541, reset)
- [NIT] one FIXED, one not taken

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] fleet.restore()'s change had no guard (measured: a revert passed) --> FIXED (de937aa865)
- [WARNING] attachment-stream's stall arm passed on Windows with no checks --> FIXED (de937aa865, skip under #9276)
- [WARNING] update-pause's Mac pin applied on Linux too --> FIXED (de937aa865, Windows only)
- [NIT] five FIXED, two not taken

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (round 5's arm pinned only half)
- [WARNING] the fleet.restore() arm pinned the pane source, not the capture --> FIXED (00a7da795c; a revert of either half reds it)
- [NIT] one FIXED, one no change

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the plan's counts were stale)
- [WARNING] a conflict with main in tools/windows-tests.js (#9283) --> FIXED (rebase; one three-way merge of the final states, 221 entries, none twice)
- [WARNING] the plan's skip count and two lines were stale --> FIXED (5d0731c6d4)
- [WARNING] win4-8378 skips for the cause this helper fixes --> ANSWERED (its owner told; follows up after this merges)
- [NIT] four not taken (all noted in earlier rounds)

### Final Ledger

| # | Iter | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | 1 | WARNING | compat-hidden OFF arm skipped | FIXED 250c33c84b |
| 2 | 1 | WARNING | #9279 skip reasons wrong | FIXED 250c33c84b |
| 3 | 1 | WARNING | no Windows guard after merge | ANSWERED #9286 |
| 4 | 1 | WARNING | board child half switched | FIXED 250c33c84b (documented) |
| 5 | 2 | WARNING | remote-bind entry false | FIXED f4450243e3 |
| 6 | 2 | WARNING | builtfiles entry incomplete | FIXED f4450243e3 |
| 7 | 2 | WARNING | compat add gate not shown | FIXED f4450243e3 (stated) |
| 8 | 3 | WARNING | Mac cards on Windows | FIXED 0889e5dd88 (stated) |
| 9 | 3 | WARNING | three ways to do one thing | ANSWERED 0889e5dd88 |
| 10 | 3 | WARNING | silent seam loss; empty passes | FIXED 0889e5dd88 |
| 11 | 4 | WARNING | engine install unpinned | FIXED d9f5c03541 |
| 12 | 4 | WARNING | preload never ran | FIXED d9f5c03541 |
| 13 | 4 | WARNING | helper state left set | FIXED d9f5c03541 |
| 14 | 5 | WARNING | fleet.restore unguarded | FIXED de937aa865 |
| 15 | 5 | WARNING | stall arm empty on Windows | FIXED de937aa865 |
| 16 | 5 | WARNING | update-pause pin on Linux | FIXED de937aa865 |
| 17 | 6 | WARNING | capture half unpinned | FIXED 00a7da795c |
| 18 | 7 | WARNING | conflict with main | FIXED (rebase) |
| 19 | 7 | WARNING | stale plan counts | FIXED 5d0731c6d4 |
| 20 | 7 | WARNING | win4 overlap | ANSWERED (owner told) |

### NITs (non-blocking, across all iterations)
Listed under each iteration; the ones not taken are in the PR body.

### Strengths (across all iterations)
One helper fixes the shared cause on Windows and does nothing elsewhere, pinned by its own test on every host. Every
skip names what Windows lacks or an open card. The plan states what a Windows green does and does not prove.

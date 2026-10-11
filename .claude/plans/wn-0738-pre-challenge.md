---
pre_challenge: true
method: challenge-loop
branch: wn-0738
diff_hash: 39a18bc336fb237a64f4175a00eaae593977196fd5980f0d124e569f31bcc0e2
validation: passed
subdir_audit: passed
timestamp: 2026-10-10T18:01:35Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** Yes
**Total findings:** 13 actionable (1 BLOCKER, 12 WARNINGs, 0 CONVENTIONs), many NITs
**Fixed:** 13 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: the full suite on Mortals for hash 39a18bc336fb (18661 tests, 18418 pass, 243 skipped, 0 fail, entry
clean), then `validation_log_run_or_skip` locally (skipped on that clean entry) and the subdir audit (passed).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] release/whats-new-pool.json: "Answer Claude questions with a button" untagged, false on Windows (headless agents, no window) --> FIXED (938b8e5a6: tagged mac)
- [WARNING] .claude/plans/wn-0738.md: Windows count wrong once tagged --> FIXED (938b8e5a6)
- [WARNING] release/whats-new-pool.json: reply-by-number and "Kosmos waits" are next in line and also screen-read --> FIXED (938b8e5a6: tagged mac)
- [NIT] Token Usage line (restart caveat) --> taken
- [NIT] daily-times "can" --> not taken

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] release/whats-new-pool.json: Token Usage still implied an unmeasured speed-up --> FIXED (675643f1d)
- [NIT] daily line said an agent sets it --> taken; [NIT] line numbers --> not taken; [NIT] button line scope --> not taken

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] release/whats-new-pool.json: Token Usage line describes an internal read nobody sees --> FIXED (671af641a: item removed)
- [NIT] "a daily task", [NIT] DM thread wording, [NIT] community title echoes 0.7.37 --> all taken

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above
- [WARNING] .claude/plans/wn-0738.md: cited chat.js:1305 (Codex hooks) for the Windows refusal --> FIXED (fc20f2e60: keysAllowed, claudeMenuRefusal)
- [NIT] stray blank line --> taken

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json: daily times not doable in the app, next in line --> FIXED (0042c347a: held)
- [NIT] plan title, [NIT] retitle effect --> taken; [NIT] line 1078 --> not taken

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] release/whats-new-pool.json: `held` means dropped in the tool's own words --> FIXED (acfa464b2: item out of the pool, note on #5752)
- NITs not taken (wording already weighed; "around" line numbers)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] .claude/plans/wn-0738.md: the #5764 paragraph said slice 3 adds the time control; #5771's button adds an agent to a project --> FIXED (ad4649c18; #5752 note corrected by comment id)
- [WARNING] .claude/plans/wn-0738.md: #5771 merged mid-loop and was never weighed --> FIXED (ad4649c18: rebased on d36c8a8b, in the pool at 9.5)
- [NIT] duplicated retraction --> claimed taken, actually left (see iteration 8); [NIT] Mac-only scope of retitle --> taken

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] release/whats-new-pool.json: #5771 line "offers to add that agent" overclaims (button needs a live agent named by its own token) --> FIXED (8462038a3)
- [NIT] stale "#5771 unmerged" tail left by iteration 6's edit --> taken (8462038a3)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release/whats-new-pool.json | BRANCH | button item true on Mac only | FIXED | 938b8e5a6 |
| 2 | 1 | WARNING | .claude/plans/wn-0738.md | BRANCH | Windows count | FIXED | 938b8e5a6 |
| 3 | 1 | WARNING | release/whats-new-pool.json | BRANCH | neighbouring question items untagged | FIXED | 938b8e5a6 |
| 4 | 2 | WARNING | release/whats-new-pool.json | SELF | Token Usage speed claim | FIXED | 675643f1d |
| 5 | 3 | WARNING | release/whats-new-pool.json | SELF | Token Usage line says nothing useful | FIXED | 671af641a |
| 6 | 4 | WARNING | .claude/plans/wn-0738.md | SELF | wrong code citation | FIXED | fc20f2e60 |
| 7 | 5 | WARNING | release/whats-new-pool.json | BRANCH | daily times not doable in app | FIXED | 0042c347a |
| 8 | 6 | WARNING | release/whats-new-pool.json | SELF | held misused | FIXED | acfa464b2 |
| 9 | 7 | WARNING | .claude/plans/wn-0738.md | SELF | slice-3 premise wrong | FIXED | ad4649c18 |
| 10 | 7 | WARNING | .claude/plans/wn-0738.md | BRANCH | #5771 not weighed | FIXED | ad4649c18 |
| 11 | 8 | WARNING | release/whats-new-pool.json | SELF | #5771 line overclaims | FIXED | 8462038a3 |

### NITs (non-blocking, across all iterations)
- Iteration 9: #5771's merge time is 12:17 CDT by GitHub (plan says 12:19, from Splinter); the retitle reasoning could say 0.7.33 and 0.7.34 were held; "every Claude question" in Decided should be "every single-choice"; "versions entry" in Reviews 3 and 5 means ~/.release-entry-0738.html on the cut box; "around 1078" is 1079.
- Earlier rounds: line-number precision, the button line's brevity, the daily-times "can".

### Strengths (across all iterations)
- The pool bookkeeping matches the tool's rules exactly: 0.7.37's five titles marked shown, lastProd 0.7.37, no rank ties, the built file byte-identical to the pool's top five (every round).
- The Mac-only tags are backed by the code (noWindow, keysAllowed, claudeMenuRefusal) (iterations 3, 5, 7, 8, 9).
- Items whose claims cannot be made true yet (Token Usage, daily times) are left out with recorded reasons (iterations 5, 7, 9).

---
pre_challenge: true
method: challenge-loop
branch: switchmem-7410
diff_hash: d2d0c1c345eb7c8c9123b7572b9f7e0740042d29af0b0848671125374f1575b1
validation: switchmem 31/31, switch-family 6/6, policy tests green on Windows; CI fixes: spoken-name class guard, change-dialog 3/3, block-delivery 14 of 14; setProvider's own tests need schtasks, CI is the real check
subdir_audit: passed
timestamp: 2026-10-28T04:29:05Z
iterations: 8
converged: true
---

# Pre-PR review proof: switchmem-7410

**Iterations:** 8
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/switchmem-7410.md

## Rounds

#### Iteration 1
- Round 1: [WARNING] another agent's notes could be copied (shared slug, notes newer than transcripts, no transcripts) --> FIXED; [WARNING] brief written with bare fs.writeFileSync --> FIXED; [WARNING] server's CLAUDE_CONFIG_DIR read --> FIXED; [WARNING] Claude <-> DeepSeek said everything stays --> FIXED; [NIT] x5 (own wording for no transcripts, ambiguous pointed, lstat before copy and 1 MB cap, copy into memory/claude-notes/, blocked and link tests) --> FIXED

#### Iteration 2
- Round 2: [WARNING] same-name check case-sensitive on Windows/macOS --> FIXED; [WARNING] knownFolders returned a partial list on errors --> FIXED; [NIT] unchecked test --> FIXED; [NIT] newer wording --> FIXED; [NIT] copied-but-not-pointed sentence --> FIXED

#### Iteration 3
- Round 3: [WARNING] failed copies dropped silently (said as no notes) --> FIXED; [NIT] non-file in a note's place counted kept, pointer counted any .md --> FIXED; [NIT] unparseable profile not named in the log --> FIXED

#### Iteration 4
- Round 4: [WARNING] link/junction swapped in between the check and mkdir --> FIXED (residual per-file swap ACCEPTED, no portable fix in Node); [NIT] occupied place counted apart --> FIXED; [NIT] note time rechecked before its copy --> FIXED

#### Iteration 5
- Round 5: [WARNING] a folder that could not be made read as blocked (regression from round 4) --> FIXED; [NIT] memory/ a junction, never point at blocked notes --> FIXED

#### Iteration 6
- Round 6: [WARNING] pointer decided from the outcome, not the disk (junction pointed on other outcomes) --> FIXED; [NIT] memory/ turned file after the check read as failed --> FIXED

#### Iteration 7
- Round 7: [WARNING] a pointer the brief already carried was never taken out --> FIXED (two blocks left untouched: ACCEPTED); [NIT] redundant blocked guard --> FIXED (kept, commented)

#### Iteration 8
- Round 8: no blocker, no warning (converged); [NIT] failed pointer removal swallowed --> FIXED; [NIT] marker text removed with the block named in Not covered --> FIXED; [NIT] stale comment --> FIXED

### Final Ledger
# Review ledger: switchmem-7410 (#7410)

| Round | Blockers | Warnings | Outcome |
|---|---|---|---|
| 1 | 0 | 4 | All fixed (5 nits fixed) |
| 2 | 0 | 2 | All fixed (3 nits fixed) |
| 3 | 0 | 1 | Fixed (2 nits fixed) |
| 4 | 0 | 1 | Fixed; residual per-file link swap accepted (2 nits fixed) |
| 5 | 0 | 1 | Fixed (a regression from round 4; 1 nit fixed) |
| 6 | 0 | 1 | Fixed (1 nit fixed) |
| 7 | 0 | 1 | Fixed; two-block brief left untouched, accepted (1 nit fixed) |
| 8 | 0 | 0 | Converged (3 nits fixed) |

## Validation
On this Windows box: engine/create.switchmem-7410.test.js 31/31 (none skipped, so the real-junction and symlink cases
ran) and web.switch-family-7410.test.js 6/6. Policy tests green: fixture-discipline 20, no-name-refs-3071 4,
engine.reachable 8, windows-tests-1777 23, win32-separator-guard 4, windows-coupling-audit-1732 8, marker-registry 3;
also backupsessions 11, create.test 127. Every review fix has a test that fails on the commit before it. setProvider's
own existing tests (the 2811 exact-writes set, switch-account, google-xai, compat, qwen) cannot run on Windows because
they need schtasks; they fail identically on origin/main here, so Mac/Linux CI is the real check for them.

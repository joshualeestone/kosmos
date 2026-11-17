---
pre_challenge: true
method: challenge-loop
branch: astra-8593
diff_hash: 1faddd8ebb0ea29b6d112cc60f252a405a0d15a6a9b133110a70eb5f6ce7bcde
validation: passed (full suite r2 through queued-heavy on 5648f51227, 17:54 to 18:18 CST: node 28803 pass, 0 fail; test:shell 4 shards all green; END rc=0. r1 on 4bbbfa5ab0 had one red, the win32-host guard windows-tests-1777, fixed in 5648f51227. Then rebased onto main 97cc713df5 for #8604 (Ice Cream Kitty, same supervisor block and tools/windows-tests.js; the one conflict kept both exclusion entries); after the rebase: 2927 dependent node tests pass, 0 fail, and the 7 supervisor shell tests pass. The full suite itself ran before the rebase. PR CI on 8efc170e92: every job green except windows, where runners.test.js #979 compared status() to the base pin rather than the Windows pin (test-only, fixed after).)
subdir_audit: passed (no CLAUDE.md changed)
timestamp: 2026-11-17T00:18:27Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes. Round 5 found no blocker or warning; its two cheap nits were fixed (4bbbfa5ab0, before the rebase e97260bed7).
**Total findings:** 2 BLOCKERs (1 fixed: no upgrade path; 1 answered by measurement: the gpt-6 default), 12 WARNINGs, 0 CONVENTIONs, 19 NITs
**Fixed:** 1 BLOCKER, 10 WARNINGs | **Answered by measurement:** 1 BLOCKER, 1 WARNING | **Filed as follow-ups:** #8597, #8598 (and #8596, found by the dependent run) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] a pin bump never upgraded an existing managed Codex (resolveBin present, install() answers installed) --> FIXED (dd3b43dbbe: stale detection from pkg/package.json, install() replaces, server.js runner-upgrade sweep)
- [WARNING] gpt-6 default on a Codex that cannot run it --> ANSWERED (the list is API-key only; a live API-key turn on 0.149.1 answered gpt-6-astra)
- [WARNING] the org-chart reader accepted 0.169.0 unmeasured --> FIXED (dd3b43dbbe: capture test run on 0.169.0; four new catalog fields handled)
- [WARNING] 0.169.0 terminal screens unmeasured --> FIXED/MEASURED (Enter gap unchanged; a background daemon found and turned off with --no-daemon; the launch-time model menu filed as #8597)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [BLOCKER] gpt-6 default where Codex cannot run it --> ANSWERED (same measurement as iteration 1)
- [WARNING] routes refuse for the whole upgrade download --> FIXED (3c794079bd, installing() excludes an upgrade until its swap)
- [WARNING] a failed upgrade leaves no Codex and retries forever --> FIXED (3c794079bd, previous tree kept and restored; 3 tries per pin)
- [WARNING] comment claimed running agents untouched by the swap --> FIXED (3c794079bd, reworded; the risk filed as #8598)
- [WARNING] --no-daemon missed when the version read is empty --> FIXED (3c794079bd, on-disk version fallback for the managed runner)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 3 of the above
- [WARNING] status() and two OpenAI routes still read the job phase --> FIXED (073657357b, all read installing())
- [WARNING] another board's sweep could delete the kept pkg.old (rename keeps mtime) --> FIXED (073657357b, mtime stamped)
- [WARNING] stale meant "different", not "older" --> FIXED (073657357b, olderVersion)
- [WARNING] a running older Codex uses the new tree's side files --> FILED (#8598; holding the swap could block the upgrade indefinitely)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] a failure after the swap but before the prove was not restored --> FIXED (ef1e1f4fb7, restorePrevious on any post-swap failure)
- [NIT] the sweep spent tries on joins --> FIXED (ef1e1f4fb7)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] missing full stop before "The version already here is kept." --> FIXED (4bbbfa5ab0)
- [NIT] restore keyed on the folder existing, not on this run setting it aside --> FIXED (4bbbfa5ab0, setAside flag)
- [NIT] message understates two edge cases --> DEFERRED (the outcome is honest; noted)

### Validation

- Each fix has a test that a mutation of it reds: stale detection, install of a stale runner, rollback on a failed prove, rollback on a failed link, installing() during an upgrade, status() during an upgrade, older-only, setAside.
- Real-Codex measurements on this Mac (no live quota except one-word API-key turns): hook trust (codexhooks-5812 real arm on 0.169.0), org-chart capture (8/8 on a real 10-model 0.169.0 catalog; shell-tool mutation reds it), token refresh through the auth.json symlink (both versions), Enter gap and --no-daemon (TUI in tmux, fake provider).
- Full suite r2 (queued-heavy) on 5648f51227: node 28803/0, shell 4 shards green, END rc=0.

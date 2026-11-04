---
pre_challenge: true
method: challenge-loop
branch: linuxlegs-7933
diff_hash: f271eda879072e5c7848c47e818621a62fbb196a3e0ee91926046536797dd2fe
validation: passed (static guards that scan tools/ and workflows plus the three file-only lints, 2057 tests, 0 fail, on the final files; the new legs themselves green on ubuntu-24.04, run 41833164322; the full node suite runs as this PR's CI. Change is new files only: a tools script, a seed script and a workflow)
subdir_audit: passed
timestamp: 2026-11-04T13:03:30Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 46 (0 BLOCKERs, 15 WARNINGs, 0 CONVENTIONs, 31 NITs)
**Fixed:** 13 WARNINGs and most NITs | **Deferred:** 3 | **Asked (awaiting user):** 0

Every round's code was run on a stock ubuntu-24.04 runner through the linux-promote-ci-7933 branch (runs
41826266536, 41828017088, 41830153470, 41830747660, 41831834685, 41832279911, 41833164322), and verify and data
were rehearsed on this Mac against the live 0.7.86 and 0.7.88 artifacts. Controls measured red: a foreign listener
on the data port, a wrong seed name over /api/projects, an uncut "cut" tarball.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] update leg read the page meta (read from disk per request), so a board never restarted could pass --> FIXED (1e32068): x-kosmos-board of the answering process, plus MainPID must change
- [WARNING] no check that a jump happened (staging == prod, or /setup installing staging) --> FIXED (1e32068)
- [WARNING] version control died on a zero-padded patch (measured: 0.5.09) --> FIXED (1e32068): 10#
- [WARNING] a foreign listener on the data port passed every boot; no trap --> FIXED (1e32068), control measured red
- [WARNING] the dead install beacon was not asserted --> FIXED (1e32068)
- NITs: version field required, first-board timeout fails at once, board's own Update no longer pressed, all mac skips update --> FIXED; unpacked-files control, no test of the script --> noted

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] error scan missed uncaught/SyntaxError/EADDRINUSE --> FIXED (a101c7c), matched lines printed
- [WARNING] data readback went through the engine, not the running board --> FIXED (a101c7c): /api/projects per boot, perturbation measured red
- NITs: controls match refusal text, early exit when a board dies, header wording --> FIXED; field sed, listener vs MainPID --> taken in iteration 3

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 8 NITs
**Self-generated:** 0 of the above
- [WARNING] both builds ran on prod's node --> FIXED (fb62b71): each on its own runtime
- [WARNING] listener not tied to systemd's MainPID --> FIXED (fb62b71): ss + PPid walk
- [WARNING] a promote does not wait for these legs --> FIXED (fb62b71) as documentation; wiring into promote-channel.sh is out of scope (on the card)
- NITs: channel wording, channel stamp asserted, persist-credentials false, plain pointer file names, no curl | grep -q, trailing space --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the iteration 3 channel assertion)
- [WARNING] the "channel still staging" assertion was vacuous: the leg wrote staging itself --> FIXED (e29cf0c): prod stamp asserted, borrowed for the board's check, put back; final check reads the installer's stamp (run green)
- [WARNING] case-insensitive FAIL could turn a benign "failed" line red --> DEFERRED: a false red only, 0 lines on every run so far
- NITs: non x.y.z version guard, data path comment --> FIXED; data leg not reading the header --> noted

#### Iteration 5
**Reviewer model:** opus (default), whole branch, no plan file
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the iteration 4 borrowed stamp's purpose)
- [WARNING] the board's own update check was printed, not asserted --> FIXED (fa30899): must offer the staged version on staging
- NITs: data step runs when verify is red, controls via case, "Updating it in place" asserted, setup_sha256 checked --> FIXED; SKIPPED vs FAIL wording off CI --> noted

#### Iteration 6
**Reviewer model:** sonnet, whole branch, no plan file
**New findings:** 0 BLOCKERs, 0 NEW WARNINGs (2 raised), 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] case-insensitive FAIL scan --> duplicate of iteration 4, DEFERRED
- [WARNING] ss printing no pid would fail with a misleading message --> DEFERRED: fails closed (reviewer: "safe and not a defect")
- NITs: greedy field sed, no readback after the 3rd boot, prod tarball hash-only, no PR-time syntax check, long lines --> noted
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | Page meta, not the running process | FIXED | 1e32068 |
| 2 | 1 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | No jump asserted | FIXED | 1e32068 |
| 3 | 1 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | Octal patch | FIXED | 1e32068 |
| 4 | 1 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | Foreign listener passes boots | FIXED | 1e32068 |
| 5 | 1 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | Beacon not asserted | FIXED | 1e32068 |
| 6 | 2 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | Narrow error scan | FIXED | a101c7c |
| 7 | 2 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | Engine read, not board | FIXED | a101c7c |
| 8 | 3 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | Both builds on prod's node | FIXED | fb62b71 |
| 9 | 3 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | Listener not systemd's | FIXED | fb62b71 |
| 10 | 3 | WARNING | .github/workflows/linux-promote-check-7933.yml | BRANCH | Promote does not wait | FIXED | fb62b71 (documented) |
| 11 | 4 | WARNING | tools/promote-check-legs-7933.sh | SELF | Vacuous channel assertion | FIXED | e29cf0c |
| 12 | 4 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | FAIL scan false red | DEFERRED | Fails safe, 0 on every run |
| 13 | 5 | WARNING | tools/promote-check-legs-7933.sh | SELF | Board check unasserted | FIXED | fa30899 |
| 14 | 6 | WARNING | tools/promote-check-legs-7933.sh | BRANCH | ss without pid misleads | DEFERRED | Fails closed |

### NITs (non-blocking, across all iterations)
- No test of the script itself, and no PR-time syntax check of it (iterations 1, 6)
- Greedy single-line field sed on pointers (iterations 2, 6)
- No on-disk readback after the third boot (iteration 6)
- The prod tarball is hash-checked, not signature-checked (iteration 6)

### Strengths (across all iterations)
- The update leg proves the transition from the outside: answering process's header, new MainPID, listener owned by systemd, installer's own stamp, beacon on unit and process (iterations 3 to 6)
- Controls refuse for the stated reason, matched on text (iterations 2, 5, 6)
- Workflow is minimal and injection-safe: contents read, no credentials persisted, site only through env (iterations 1 to 6)

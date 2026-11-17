---
pre_challenge: true
method: challenge-loop
branch: win-codex0169-8593
diff_hash: f8edab9a25e4e6d89b188abced3978273a0d70b8ee6446b7962ac0100b9ea6ba
validation: targeted (the validation-log helper needs npm, which this Windows box does not have; the repo's type-check and lint-fix scripts are echo no-ops. Ran the 20 affected suites and the policy tests instead: 268 tests, 242 pass, 0 fail, 26 skipped; the new Windows tests again under an 8.3 TEMP: 41 pass, 0 fail)
subdir_audit: passed
timestamp: 2026-11-17T22:45:08Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped by the fleet 8-round rule after iteration 8: "A review (challenge) loop stops at 8 rounds unless a BLOCKER is still open. Past 8 rounds, WARNINGs go to a follow-up card, not another round." (Splinter, 2026-10-22, restated over Slack 2026-10-26 16:08 CDT.) No BLOCKER was open. Round 8's two unsafe-leaning WARNINGs were fixed and tested; the rest went to #8659.
**Total findings:** 23 (0 BLOCKERs, 18 WARNINGs, 5 CONVENTIONs), plus NITs
**Fixed:** 19 | **Deferred:** 3 | **Carded (#8659):** 1 WARNING + NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 CONVENTIONs, 5 NITs
- [WARNING] server.js sweep: a busy answer at install()'s pre-swap check still spent one of the three tries --> FIXED (job.waited hands the try back; 1cf434a88a)
- [WARNING] server.js: the Windows branch of the sweep had no test --> FIXED (sweep moved to engine/runnerupgrade.js with injected deps and its own tests; 1cf434a88a)
- [WARNING] runners.js restorePrevious: a new tree antivirus will not delete lost the old tree --> FIXED (renamed aside to pkg.new-*-failed, old tree restored; 1cf434a88a)
- [CONVENTION] skip reasons in tools/windows-tests.js and runners.stale-codex-8593.test.js said Windows has no upgrade --> FIXED (1cf434a88a)
- [CONVENTION] plan named a commit not on the branch and a wrong date --> FIXED (1cf434a88a)
- [CONVENTION] WIP commit subject --> DEFERRED: the PR is squash-merged, so the subject never reaches main
- [CONVENTION] .claude/plans/runnerrestart-8598.md says Windows stays on 0.149.1 --> DEFERRED: a dated record of that branch, not current docs
- NITs fixed: overstated comments, a shadowed name, comment wrap, an assertion message

#### Iteration 2
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] runners.js: a wait at the pre-swap check deleted the 187 MB download, so it could repeat every 30 minutes --> FIXED (verified tarball kept and reused at its published size, checksum still decides; d2850a1e66)
- [WARNING] runners.js managedProcessRunning: a plain string-prefix match missed 8.3 and junction spellings, which reads "nothing running" (unsafe) --> FIXED (both sides resolved; real-process test with a control that fails without the fix; d2850a1e66)
- [WARNING] runners.js: a person's install while an agent runs downloaded first and waited after --> FIXED (a look before the download; d2850a1e66)

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] runners.js: the first look deleted a kept tarball --> FIXED (181870587b)
- [WARNING] runners.js resolveBin: a newer build's marker read absent, inviting a downgrade --> FIXED (reads present and not stale, as on the Mac; 181870587b)

#### Iteration 4
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] runners.js exeUnder: realpathSync on every process could freeze the board on a dead network drive --> FIXED (only the managed folder's own drive is resolved, async, with a deadline; 72213f144a)
- [WARNING] a wait reported as phase failed reaches the person --> DEFERRED with a pinning test: the Codex install button shows only for a missing runner, a stale one reads present, and status() drops a failed job beside a present runner (test asserts what the screen reads)
- [WARNING] three back-to-back CIM reads per tick --> FIXED (agentsCheckedIdle skips install()'s first look; 72213f144a)

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] runners.js: seconds-long gap between the last look and the rename under antivirus retries --> FIXED (a last look after the marker comes down; d8319dbaba)

#### Iteration 6
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] Windows Codex agents run one codex exec per turn, so the swap lands between turns; cross-version resume unmeasured --> FIXED in the plan (measured on the real 0.169.0 codex.exe: every per-turn argument accepted; cross-version resume of a 0.149.1 thread not measurable on this box, owed live check carded on #8659; 6f0b1830a2)
- [WARNING] the last look's refusal window was unnamed and had a 20 s deadline --> FIXED (5 s deadline, named; 6f0b1830a2)

#### Iteration 7
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] the supervisor spawns codex.exe per turn without asking resolveBin, so the marker did not stop a turn --> FIXED (swap lock `<runners>/openai/.swapping`; the supervisor waits on it before each Codex turn; 16570c068b)
- [WARNING] timeouts at the last look could re-unpack every tick unseen --> FIXED in part (a look before the unpack, waits logged with their reason; 16570c068b); the remaining loop is on #8659

#### Iteration 8
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] waitForSwap matched the bin against managedRoot() by string prefix: a different spelling skipped the wait (unsafe) --> FIXED (the lock is found from the bin itself, any spelling; tested with slashes, case, \\?\ and the 8.3 name; 970870bad7)
- [WARNING] a job could remove another board's swap lock --> FIXED (removed only while it still holds this job's text; 970870bad7)
- [WARNING] 5 s last-look timeouts can loop an upgrade every 30 minutes --> CARDED #8659 (fleet 8-round rule)
- NITs --> CARDED #8659

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | server.js | busy pre-swap spent a try | FIXED | 1cf434a88a |
| 2 | 1 | WARNING | server.js | Windows sweep untested | FIXED | 1cf434a88a |
| 3 | 1 | WARNING | runners.js | locked new tree lost old tree | FIXED | 1cf434a88a |
| 4 | 1 | CONVENTION | tools/windows-tests.js | stale skip reasons | FIXED | 1cf434a88a |
| 5 | 1 | CONVENTION | plan | commit id and date | FIXED | 1cf434a88a |
| 6 | 1 | CONVENTION | git | WIP commit subject | DEFERRED | squash merge |
| 7 | 1 | CONVENTION | runnerrestart-8598 plan | stale line | DEFERRED | dated record |
| 8 | 2 | WARNING | runners.js | wait deleted the download | FIXED | d2850a1e66 |
| 9 | 2 | WARNING | runners.js | 8.3/junction miss reads not running | FIXED | d2850a1e66 |
| 10 | 2 | WARNING | runners.js | person install downloads then waits | FIXED | d2850a1e66 |
| 11 | 3 | WARNING | runners.js | first look deleted kept tarball | FIXED | 181870587b |
| 12 | 3 | WARNING | runners.js | newer marker read absent (downgrade) | FIXED | 181870587b |
| 13 | 4 | WARNING | runners.js | sync realpath could freeze the board | FIXED | 72213f144a |
| 14 | 4 | WARNING | runners.js | wait shown as failure | DEFERRED | pinned by test |
| 15 | 4 | WARNING | runnerupgrade.js | redundant CIM reads | FIXED | 72213f144a |
| 16 | 5 | WARNING | runners.js | gap under antivirus retries | FIXED | d8319dbaba |
| 17 | 6 | WARNING | plan | per-turn agents, resume unmeasured | FIXED | 6f0b1830a2, owed check on #8659 |
| 18 | 6 | WARNING | runners.js | last-look refusal window | FIXED | 6f0b1830a2 |
| 19 | 7 | WARNING | win32codexsup.js | turns ignore the marker | FIXED | 16570c068b |
| 20 | 7 | WARNING | runners.js | timeouts re-unpack unseen | FIXED in part | 16570c068b, rest #8659 |
| 21 | 8 | WARNING | runners.js | waitForSwap spelling skip | FIXED | 970870bad7 |
| 22 | 8 | WARNING | runners.js | another board's lock removed | FIXED | 970870bad7 |
| 23 | 8 | WARNING | runners.js | 5 s last-look timeout loop | CARDED | #8659 |

### Outstanding questions (ASKED)
- None.

### NITs (non-blocking)
- Iteration 1: managedProcessRunning 8.3 note (later fixed in iteration 2); comment lengths (fixed).
- Iteration 2: shared helper for the managed Codex folder (not taken: the lock is found from the bin, and the sweep reads managedRoot()).
- Iterations 5 to 8: elevated processes are not seen (named in the comment); beforeWait failure only warns, settled-less job comment, codexhooks-5812 reference-equality assertion, a Windows reader for the upgrade record (all on #8659).

### Strengths
- Every unreadable answer fails safe: no sentinel, a CIM error, a deadline, an unresolvable folder, a thrown check, an unreadable lock all keep the old version.
- The sweep's rules live in an injectable module with focused tests; a wait never spends a try.
- restorePrevious covers the Windows failure paths, each with its own test and a PRECONDITION assertion.
- Real-process tests on the Windows box for the 8.3 and sibling-prefix cases, with negative controls run against the code before each fix.

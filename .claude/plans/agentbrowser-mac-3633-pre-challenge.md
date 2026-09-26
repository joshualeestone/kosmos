---
pre_challenge: true
method: challenge-loop
branch: agentbrowser-mac-3633
diff_hash: f4efe2f4f81dd454d5a8434fb0b9e9aa5b00cd2043ea3313bc11d50946a54431
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T00:13:02Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19
**Converged:** Yes (iteration 19: NITs only)
**Total actionable findings:** 1 BLOCKER, 36 WARNINGs, 5 CONVENTIONs (plus NITs, many taken)
**Fixed:** all but 1 | **Deferred:** 1 (the shared install lock, by design) plus 2 synthetic validation findings | **Asked (awaiting user):** 0

Reviewer models rotated opus / sonnet / fable. Every fix that added a test was checked with a
control: the fix removed or reverted, the named test red, then restored.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] one boot-time install, no retry, no log --> FIXED: installWithRetry with backoff and logging
- [WARNING] opt-out unreachable on a Mac (launchd env) --> FIXED: an `off` file in the managed folder; the boot install honours it
- [WARNING] staging leftovers never swept --> FIXED: sweep of dead-owner staging and old versions
- [WARNING] "launch never installs" checks could not fail --> FIXED: checks observe the folder; controls with the shim switched to install both went red
- [WARNING] two installs could race --> FIXED: a lock file

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 3 of the above
- [BLOCKER] shellDir keyed by version only: installing one CPU deleted the other's shell --> FIXED: per-CPU folders; test red on the old code
- [WARNING] age-based lock takeover could steal from a live slow download --> FIXED: heartbeat lock
- [WARNING] sweep deleted every non-current version --> FIXED: keep the previous one
- [CONVENTION] plan claimed CPU mismatch was harmless --> FIXED

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 8 NITs
**Self-generated:** 1 of the above
- [WARNING] cross-CPU test failed on an Intel host --> FIXED
- [WARNING] harness-booted boards would download 100 MB into the real folder --> FIXED: DRY_RUN skip and `KOSMOS_AGENT_BROWSER=off` in tools/browser-checks.sh

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 2 of the above
- [WARNING] a double lock-holder's swap could delete a proven install --> FIXED: re-check after the lock and before the swap; test red on the old code
- [WARNING] `.DS_Store` counted as a version, deleting the real previous --> FIXED: version-named folders only, version order
- [WARNING] a permanent checksum mismatch re-downloaded forever --> FIXED: give-up after 3

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (prose claims from iteration 4)
- [WARNING] "never replaces a proven install" overclaimed --> FIXED: claim deleted, mechanism stated
- [WARNING] configFor picked Edge from a falsy path --> FIXED: explicit platform; a Mac config without a path throws

#### Iteration 6
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] EACCES test not skipped on Windows --> FIXED
- [WARNING] tests read the operator's KOSMOS_AGENT_BROWSER --> FIXED: env {} and child env cleared
- [WARNING] takeLock's mkdir could throw --> FIXED
- [CONVENTION] plan pruning wording --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above
- [WARNING] a lock read before its pid was written was taken over --> FIXED: unreadable pid counts as live; test red on the old code

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] plan overclaimed opt-out removal timing --> FIXED
- [WARNING] pruning edge unnamed --> FIXED: stated in Known and left

#### Iteration 9
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] a wrong-size body counted as a checksum failure --> FIXED: pinned byte sizes, checked before the hash
- [WARNING] the Mac kick chain untested --> FIXED: test with a win32 control; red with the chain broken
- [WARNING] no-build retried forever --> FIXED: terminal

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 8 NITs
**Self-generated:** 1 of the above
- [WARNING] plan: a pruned running browser keeps working --> FIXED: claim deleted
- [WARNING] future version bump leaves agents without a browser --> FIXED: stated in Known and left
- [WARNING] backoff untested --> FIXED: schedule seam; red without doubling

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] CPU derived twice --> FIXED: one hostArch(), pinned by a test
- [CONVENTION] CLAUDE.md row missing --> FIXED

#### Iteration 12
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tests depended on earlier tests --> FIXED: fixtures
- [WARNING] the model launch line untested --> FIXED: arm 5; red with that line broken
- [WARNING] no success log after retries --> FIXED

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] prove/unpack failures retried forever --> FIXED: stage tracking; give-up counts any failure after a complete download
- [WARNING] shim test could wait on a real download --> FIXED: spawnSync timeout

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tree staging leftovers swept only on a shell install --> FIXED: sweep at board start

#### Iteration 15
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] four tests needed a folder an earlier test made --> FIXED: ensureHome
- [WARNING] wrong-size bodies retried forever --> FIXED: 24-attempt ceiling per run

#### Iteration 16
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] shim test failed alone --> FIXED; all tests then run one at a time (33/33)
- [WARNING] plan's "each passes alone" was false --> FIXED (made true, then measured)
- [WARNING] shell test unbounded --> FIXED: perl alarm, skip off Mac

#### Iteration 17
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] one lock across CPUs --> DEFERRED: one install at a time is deliberate; cost is a delayed retry; stated in Known and left
- [WARNING] a first-try install left no log line --> FIXED

#### Iteration 18
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] branch 20 behind main with conflicts --> FIXED: rebased (package.json, CLAUDE.md both sides kept); all tests rerun on the rebased tree
- [CONVENTION] plan sentence on edited Windows tests --> FIXED

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Validation
- 6.0 (first run): 63 failures, every failing file green when run alone; the Mac was at load
  19-25 (and the #3634 syspolicyd hold followed). Synthetic finding DEFERRED on that evidence.
- After rebasing onto the #3634 fix: 8835 tests, 0 fail.
- 6j on HEAD 9e8aba52 (rebased onto main 8802881): 8934 tests, 8786 pass, 0 fail; subdir audit clean.

### NITs left (iteration 19)
- the swap's re-check and rmSync are two steps (identical bytes either way)
- a fresh tree with an already-installed shell logs nothing
- a swap that ends unproven returns no reason
- `disabled()` stats the opt-out file on Windows too (nothing creates it)
- stray spaces before commas in five test lines
- the raw `process.arch` count also counts a comment mention
- the silent 100 MB first-boot download is a product call (the plan's weakest premise)

### Strengths (across iterations)
- Size check, then pinned sha256, before anything unpacks or runs
- The agent's browser never reaches the person's browser, profile or logins (asserted)
- The launch path never installs and never costs an agent its start (asserted both sides)
- Every delete scoped to this module's own folder
- Windows output unchanged

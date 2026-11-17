---
pre_challenge: true
method: challenge-loop
branch: codexmigr-8597
diff_hash: b15c10797889b5dd77ae75efd20c0207294bc24063651cb9023f77f2bb4028d8
validation: full suite at 7fb6341ade failed 1 (create.test.js #1315 pin), fixed in 67f3564f04; focused tests green at bee42d18a0; CI runs the full suite on the PR head
subdir_audit: passed
timestamp: 2026-11-17T00:06:45Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round review cap (Splinter's 2026-10-22 usage rule: past 8 only with a BLOCKER). Round 8 raised no BLOCKER. Its two WARNINGs are recorded as residuals in the plan, and its NITs were fixed or noted.
**Total findings:** 5 BLOCKERs, 25 WARNINGs, 2 CONVENTIONs, many NITs
**Fixed:** 24 | **Deferred:** 8 | **Asked (awaiting user):** 0

**Validation:**
- The full suite at 7fb6341ade ran: 29351 tests, 1 fail. The failure was create.test.js's #1315 supervisor pin: my bash added the word `else` inside the codex branch. Fixed in 67f3564f04; create.test.js then passed alone (242).
- Focused at the final head bee42d18a0:
  - engine/codexmigration-8597 (20), codexupdate (6), windows-tests-1777 (24), envcase-5386 (9), engine.reachable (8), create.test.js (242);
  - tools/test-supervisor-env.sh: all hold;
  - tools/test-supervisor-codexhome-leak-3430.sh is red on main on this Mac (kosmos#8596), not this branch.
- The subdir audit passed.
- The PR's CI full suite is the merge gate.

**Measured with the real Codex 0.149.1** (scratch home, fake provider, update notice dismissed by our own shim):
- no pin: the menu opens;
- a pin with a wrong target: the menu opens;
- a pin with the catalog's target: no menu, and the agent stays on gpt-5.4;
- end to end, the real shim wrote the pin and Codex opened with no menu.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 8 NITs
**Self-generated:** 0
- [WARNING] engine/codexupdate.js - unlocked, non-atomic config.toml write --> FIXED f26fd1f034 (filelock, temp and rename)
- [WARNING] bin/agent-supervisor.sh - pin not gated on the person's own home (`_codex_home_shared`) --> FIXED f26fd1f034
- [WARNING] engine/codexupdate.js - the spawnSync child could outlive its bound (no group kill) --> FIXED f26fd1f034 (async, own group, killed whole)
- [WARNING] plan - first-launch fetched-catalog target unmeasured --> DEFERRED: named as a residual; needs a real sign-in
- [NIT] literal and bare keys, inline notice, CRLF, 0600, /bin/bash in the test, unset temporaries, header --> FIXED f26fd1f034

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 (the temp-and-rename write, the stall test, both from iteration 1)
- [WARNING] codexupdate.js - rename without fsync, false crash claim --> FIXED fed949daf2 (securewrite.writeSecret atomicOnly, as forgetCodexFolder)
- [WARNING] codexupdate.js - temp debris on a failed write --> FIXED fed949daf2 (same)
- [WARNING] test - the stall test was timing-sensitive --> FIXED fed949daf2
- [WARNING] test - no lock test --> FIXED fed949daf2
- [WARNING] supervisor - --model=X form --> FIXED fed949daf2
- [NIT] a literal-string model; the header --> FIXED fed949daf2

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [BLOCKER] bin/agent-supervisor.sh - an installed supervisor's folder has no shim and no engine/, so the shim (and the #1315 update dismissal) never ran on an installed board. Measured on this Mac --> FIXED 1dfd8ce91f (launchPrep run through `$_eng`; an install-shaped test with a control)
- [WARNING] codexupdate.js - the cache-first order was unmeasured --> DEFERRED: a residual in the plan
- [WARNING] supervisor - a probe spawn per launch for endpoint models --> DEFERRED: about 0.05 s, bounded; accepted
- [CONVENTION] shim header stale --> FIXED 1dfd8ce91f

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (plus 2 duplicates of deferred ones), 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] codexupdate.js - a config with `profile = "x"` gives the wrong model --> DEFERRED: Kosmos never writes a codex profile (checked), and it fails open (no pin)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 (the shim-route comment, the env arm, both from iteration 3)
- [BLOCKER] test - the win32 host branch was not registered with tools/windows-tests.js (#1777 guard) --> FIXED 3fcf0fdafc
- [WARNING] comments - "the shim is for a checkout run" was false --> FIXED 3fcf0fdafc
- [WARNING] tools/test-supervisor-env.sh - proved only the fallback --> FIXED 3fcf0fdafc (an engine marker; control measured)
- [WARNING] plan - the no-model fallback is dead in a private home --> DEFERRED: a residual in the plan; harmless while the default has no upgrade
- [NIT] PATH order; header; provider-prefixed ids --> FIXED or residual, 3fcf0fdafc

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING (plus 2 duplicates), 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (the probe env, from iteration 1)
- [BLOCKER] codexupdate.js - `{ ...process.env, CODEX_HOME }` trips envcase-5386 --> FIXED 7fb6341ade (win32env.envSet; a one-key test with a control)
- [WARNING] no test armed the guard --> FIXED 7fb6341ade

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER (the full-suite red), 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 1 (the -m extraction's `else`, from iteration 2)
- [BLOCKER] the full suite at 7fb6341ade: create.test.js #1315 pin red; the word `else` inside the codex branch --> FIXED 67f3564f04
- [WARNING] codexupdate.js - an unreadable cached upgrade read as no upgrade --> FIXED 67f3564f04 (falls through to bundled)
- [WARNING] launchPrep - pinned with no named home (a hand run reaches ~/.codex) --> FIXED 67f3564f04
- [CONVENTION] a bare win32 return instead of skipOnWin32 --> DEFERRED: the file is excluded from Windows with its reason; the guard accepts it
- [NIT] the header list; the env-test message --> FIXED 67f3564f04

#### Iteration 8 (last under the cap, whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the fall-through, from iteration 7)
- [WARNING] codexupdate.js - the probe re-runs each launch until a cache exists --> DEFERRED: a residual in the plan; bounded
- [WARNING] codexupdate.js - the fall-through target may not be what a cache-using Codex checks --> DEFERRED: a residual in the plan; unmeasurable without a real Codex sign-in
- [NIT] a test title --> FIXED bee42d18a0

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/codexupdate.js | BRANCH | unlocked non-atomic write | FIXED | f26fd1f034, fed949daf2 |
| 2 | 1 | WARNING | bin/agent-supervisor.sh | BRANCH | person's own home not skipped | FIXED | f26fd1f034 |
| 3 | 1 | WARNING | engine/codexupdate.js | BRANCH | spawn could outlive its bound | FIXED | f26fd1f034 |
| 4 | 1 | WARNING | plan | BRANCH | first-launch fetched target | DEFERRED | residual |
| 5 | 3 | BLOCKER | bin/agent-supervisor.sh | BRANCH | installed supervisor never ran the shim | FIXED | 1dfd8ce91f |
| 6 | 5 | BLOCKER | engine/codexmigration-8597.test.js | SELF | #1777 guard | FIXED | 3fcf0fdafc |
| 7 | 6 | BLOCKER | engine/codexupdate.js | SELF | #5386 env guard | FIXED | 7fb6341ade |
| 8 | 7 | BLOCKER | bin/agent-supervisor.sh | SELF | #1315 pin (else) | FIXED | 67f3564f04 |
| 9 | 7 | WARNING | engine/codexupdate.js | SELF | unreadable cached upgrade | FIXED | 67f3564f04 |
| 10 | 7 | WARNING | engine/codexupdate.js | BRANCH | pin with no named home | FIXED | 67f3564f04 |
| 11 | 8 | WARNING | engine/codexupdate.js | SELF | probe per launch until cached | DEFERRED | residual |
| 12 | 8 | WARNING | engine/codexupdate.js | SELF | fall-through target vs cache | DEFERRED | residual |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- A trailing comment on an existing entry is dropped when that entry is rewritten (iterations 3 and 7).
- `-c model="X"` endpoint form not parsed (iteration 6): fails open.
- A multi-line array in the table (iteration 8): unreachable in practice.

### Strengths
- It declines whenever it is unsure, writing only the catalog's own target. That target is required by measurement.
- Every behavioural arm has a control that can come out the other way, including the installed layout and the shared home.
- The pre-existing #1315 dead dismissal on installed boards was found and fixed on the way.

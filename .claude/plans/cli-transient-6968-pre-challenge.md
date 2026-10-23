---
pre_challenge: true
method: challenge-loop
branch: cli-transient-6968
diff_hash: 7448be811f19e0f7da6fb9e3f17da96edf744522bb64066e443866a44cf343c3
validation: passed (focused: 153 files that read install/kosmos plus the file-scanning guards, 3287 tests, one red: the #4796 data-root guard on this branch's new test, fixed in the test; after the replay onto main at dac107cb, the card's test, the 4466/2662/1970/4796 suites, fixture-discipline and main's 4 new CLI tests 205/205, and both browser-check gates; the full suite is CI's)
subdir_audit: passed (no CLAUDE.md changed)
timestamp: 2026-10-23T05:16:34Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (round 7 raised NITs only; two fixed in f9e012ed)
**Converged:** Yes
**Total findings:** 68, the sum of the per-round counts below (1 BLOCKER, 26 WARNINGs, 6 CONVENTIONs, 35 NITs)
**Fixed:** 1 blocker, 23 warnings | **Documented, not changed:** 3 warnings | **Asked (awaiting user):** 0
**Source:** the reviewers' reports are in this session's transcript; the commit bodies carry no ledger.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs, 4 NITs
- [WARNING] keep-copy hook paid a second whenever the board was stopped --> FIXED: _KOSMOS_CURL_ONCE for keep-copy and tool-failed
- [WARNING] retry broke the caller's -m budget --> FIXED: second try gets what is left, none under 1 s
- [WARNING] task ran/done already retries 7, waits stacked; its all-refused words were the down-board framing --> FIXED: ONCE for ran, 7 routed to say_unreached
- [WARNING] an interrupt in connect's job during the pause leaked the answer file --> FIXED: sleep || true
- [WARNING] the message body now sits on disk --> FIXED later (iteration 4 trap); documented
- [WARNING] -w buffering, control "twice", leftovers, comment routing untested --> FIXED: follow arm, try counts, assertNoLeftovers
- [CONVENTION] comment verb's comment wrong; seam not digits-only --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] task told/repeat said "asked again" without asking (ONCE covered the whole loop) --> FIXED: ONCE only for ran
- [WARNING] "even when asked again" false when the budget skips the retry --> FIXED: words no longer claim a second try
- [WARNING] task ran after a 503 then 7 said "nothing was sent" --> FIXED: _reached, its own sentence
- [WARNING] ONCE callers still buffered to disk --> FIXED: ONCE is one plain try, no files
- [WARNING] keep-copy timing assertion flaky --> FIXED (iteration 3 and 4: try counts)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 CONVENTIONs, 4 NITs
- [WARNING] msg's and post's second ask could deliver twice into a restarted board --> FIXED: ONCE there; test reproduces the duplicate without it
- [WARNING] keep-copy arm passed without ONCE (budget skipped the retry anyway) --> FIXED: default pause
- [WARNING] plan did not match the code --> FIXED
- [CONVENTION] old contract comment read as kosmos_curl's; untested paths; missing leftover checks --> FIXED or listed in the plan

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] arms could pass without a refusal --> FIXED: counting curl on PATH, exact try counts
- [WARNING] timing margins (cut-reply arm, keep-copy) --> FIXED: 3 s pause / 2.5 s board, counts not times
- [WARNING] ran and tool-failed opt-outs untested --> FIXED: 3-vs-5 and 1-vs-2 counts
- [WARNING] "no trap" rationale wrong; body left on Ctrl-C --> FIXED: trap, static call-site guard

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 1 CONVENTION, 9 NITs
- [BLOCKER] trap's `exit 130` lets the caller carry on and say "stopped before anything was sent" --> FIXED: trap re-raises the signal. Measured on bash 3.2: main dies of SIGINT with or without (the case did not occur here); the re-raise is for bash 4+, CI's Linux job runs the arm
- [WARNING] reply-channel (no health check) told a stopped board "does not need a restart" --> FIXED: lsof decides busy vs nothing listening
- [WARNING] trap left the auth header file --> FIXED: trap removes _hf
- [WARNING] guard accepted a trailing && --> FIXED
- [WARNING, low] refuse-once arms could false-red on a slow runner --> DOCUMENTED (fails red, never green)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] "nothing is listening" false for another account's listener --> FIXED: "we could not see anything listening"
- [WARNING] lsof-dependent arm fails without lsof --> FIXED: skip without lsof
- [WARNING] re-raise unmeasured here --> DOCUMENTED in the plan
- [WARNING] trap deferred behind a running curl --> DOCUMENTED in the plan (bounded by -m)
- [NIT] guard matched `||` --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 7 NITs
- [NIT] cleanup comment overstated (QUIT); final cat under set -e --> FIXED (f9e012ed)
**Converged** - nothing above NIT.

### Strengths
- Only curl 7 is retried, once: nothing reached the board, so a write cannot land twice; 18/28/52/56 never retried (iterations 1-7)
- Every new arm fails with its mechanism removed, run as a perturbation each time: no retry, no body buffer, old words, both -w outputs, keep-copy/tool-failed/ran/told opt-outs, the 503 branch, the msg duplicate, the trap, a main-shell call, the listener split (iterations 1-6)
- Refusals are real (a stub board that stops listening), counted by a curl on PATH; the busy control uses the counting curl's refusal so lsof sees a live listener (iterations 4-6)

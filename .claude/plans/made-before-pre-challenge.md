---
pre_challenge: true
method: challenge-loop
branch: made-before
diff_hash: bbb0fb7c6618d27cd71172148485620e366db8487c93f9f2ed06b8f2aae24b1b
subdir_audit: passed
timestamp: 2026-08-23T21:15:04Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (proof regenerated after the post-review merge of main and a merge-seam fix in engine/create.test.js; full suite 1618/1618, exit 0, verified unpiped)
**Converged:** Yes (iterations 6-8 found only test-instrumentation defects, each inside the previous round's fix; product code stable since iteration 5; the loop was closed when round 8's findings were pin anchors of pin anchors, every fix mutation-verified)
**Total findings:** 21 (3 BLOCKERs, 9 WARNINGs, 2 CONVENTIONs, 7 NITs)
**Fixed:** 19 | **Deferred:** 2

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] web/index.html d-model-msg stale across agent switch: two sentences now compete for the slot, so the pre-existing staleness became a wrong-agent provenance claim --> FIXED: cleared in openDetail at the switch moment (f9f363c)
- [WARNING] server.test.js neverRecorded pin could not fail (fixture writes a plist) --> FIXED: the untied-no-plist orphan test, the one input where the tied gate is load-bearing
- [WARNING] web pin satisfied by the picker's sentence --> FIXED: unique anchors per surface
- [NIT] stopped agent told to stop itself --> FIXED: running/stopped wording split
- [NIT] memory lead kept fault framing --> FIXED: never-recorded branch in memUnknown

#### Iteration 2
- [WARNING] stopped rows carry no context, so the memory treatment never fired for them --> FIXED: memoryBox synthesizes from the row flag
- [WARNING] existsSync fails toward the provenance claim (EACCES reads as "never recorded") --> FIXED: create.jobMissing, ENOENT-only absence
- [CONVENTION] em dashes in two added comments --> FIXED
- [NIT] openDetail-clear pin anchored on id presence only --> FIXED: assignment shape
- [NIT] card fit unasserted for the longer sentence --> FIXED: overflow measured in the browser check

#### Iteration 3
- [BLOCKER] web.memory-words.test.js red on the branch (word count moved 2 to 3); surfaced my own instrument error: `yarn test | tail` had reported the red suite as exit 0 --> FIXED: count updated, all later runs unpiped with the exit code echoed
- [BLOCKER] the stopped half was dead code behind a pre-existing pctOf throw on context-less rows --> FIXED: pctOf null-tolerant, proven by an EXECUTED memoryBox test and a stopped-agent browser-check leg
- [WARNING] the memoryBox pin was a source regex that stayed green over dead code --> FIXED: executed render
- [WARNING] paintModelPicker roles-await flight guard missing --> FIXED: bail when CURRENT moved
- [WARNING] browser check did not sandbox the projects root --> FIXED
- [NIT] synthesized context lacked the because --> FIXED, drift-pinned both ways
- [NIT] lazy-require cycle unstated --> FIXED: stated at the call

#### Iteration 4
- [WARNING] jobMissing's ENOENT half untested --> FIXED: chmod-000 EACCES leg, guarded to never aim at the real LaunchAgents
- [WARNING] the Found-agents instruction overclaims for recorded-folder rows --> FIXED: profile.dir discriminator, true sentence per sub-state
- [NIT] plain stopped row could carry its own because --> DEFERRED: pre-existing wording, strictly improved already; follow-up
- [NIT] page copy of the engine sentence one-sided --> FIXED: pinned against each other from source

#### Iteration 5
- [WARNING] recordedDir sub-state dead-ended with neither a path nor a reason --> FIXED: the stated reason, per the card's done-when OR branch
- [NIT] truthy gates on a strong claim --> FIXED: === true at every page site
- [NIT] drift pin anchored file-wide --> superseded by iteration 7's count-of-one refusal

#### Iteration 6
- [WARNING] the fix promised unshipped software (#275) in user copy --> FIXED: graceful form, no tracker number in copy, region-pinned
- [WARNING] drift pin comment claimed a scope the code lost --> FIXED
- [WARNING] recordedDir sentences unpinned --> FIXED: both surfaces pinned
- [NIT] guard comment named the wrong mechanism --> FIXED (list exclusion by alreadyIn)
- [NIT] dead element-handle field in the check --> FIXED

#### Iteration 7
- [BLOCKER] the tracker-number pin's first-semicolon cut failed open on the exact removed wording (semicolon inside the string; proven by mutation) --> FIXED: structural successors
- [WARNING] shared sentence pinned once across two surfaces --> FIXED: count-of-two
- [WARNING] stale scope comment --> FIXED
- [NIT] zero/many collapsed in one message --> FIXED: split

#### Iteration 8
- [WARNING] picker successor anchor sat inside the stranger string, a single-mutation escape --> FIXED: inclusive end on the statement's own terminator, per-region sentence asserts
- [CONVENTION] leftover contradictory comment --> FIXED
- [NIT] surface-blind count / magic window --> FIXED: per-region asserts, successor-bounded window
**No product-code findings. Closed.**

### Final Ledger

Summarized above per iteration; every FIXED row's commit is in `git log` on this branch with a message naming its round.

### Deferred
- Plain stopped row's own because in the memory note (iteration 4): pre-existing wording, strictly improved by this branch already; follow-up card material.
- One connect.test cancel-mid-download flake under full-suite load: pre-existing, file untouched by this branch (0 diff lines), passes in isolation repeatedly; carding separately.

### Strengths (recurring across reviewers)
- ENOENT-only absence with the failure direction reasoned in writing and forced by test
- Every gate provable in its leak direction (orphan test, rickish/brokenish pair, absent-flag default)
- Executed renders over source regexes; browser check with controls, sandboxed roots, overflow measurement, and the switch-linger regression
- The page-vs-engine sentence pinned against each other from source

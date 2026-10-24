---
pre_challenge: true
method: challenge-loop
branch: autodeploy-6907
diff_hash: ae283090f6cbe74443f1ca0c4345d96f59248188d697963b1b4b366658cb54a1
validation: passed
subdir_audit: passed
timestamp: 2026-10-22T18:10:26Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (Splinter's 11:08 CDT usage rule caps a loop at 8 rounds, one reviewer per round)
**Converged:** Yes. Iteration 7 had no new actionable finding; iteration 8 reviewed the final head (after iteration 7's NIT fixes) and its two warnings duplicate deferred iteration 6 items.
**Validation:** 6.0 baseline was focused (the branch's own test, 95/95, plus `bash -n`; no other file references publisher_running). Final: mortals-validate on the head 3283d6b89, status `clean`, hash ae283090f6cb: node 23287 tests, 0 fail, 321 skipped; the shell suite including `tools/test-site-autodeploy-5589.sh` ALL PASS on Mortals.
**Also measured:** the matcher run against this Mac's real `ps -axo pid=,ppid=,command=`: a deploy-site.sh under a tools/test-*.sh was passed over; a hand-run one was held and named by pid.
**Total findings:** 0 BLOCKERs, 8 WARNINGs, 1 CONVENTION-class doc drift, about 20 NITs
**Fixed:** 6 WARNINGs | **Deferred:** 2 (dups) | **Asked:** 0
**Mutants (each caught by the named arm, then restored):** no test-ancestor exclusion (test arm red); exempt every parented line (hand-run, orphan, cut arms red); no node rule (node arm red); no `--test` alternative (bare node --test arm red); no publisher-naming guard (shellc arm red).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] tools/site-autodeploy.sh:284 - node suite (tools.release-gate.test.js) spawns release.sh with no tools/test-*.sh ancestor, so it still held --> FIXED ae112d2d5 (node --test / *.test.js ancestor counts; plain node does not; arms + mutant)
- [NIT] PUBLISHER doc incomplete --> FIXED ae112d2d5
- [NIT] header Skips paragraph missed the exemption --> FIXED ae112d2d5
- [NIT] argv into the CI log --> DEFERRED in plan (publishers take a version or flags; Vercel token is from the env)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (plan prose)
- [WARNING] .claude/plans/autodeploy-6907.md:33 - plan predates the node rule --> FIXED b795c5eec
- [WARNING] tools/site-autodeploy.sh:325 - argv echoed to the CI log --> DEFERRED (dup of iteration 1 NIT; plan Deferred section)
- [NIT] header line over width --> FIXED b795c5eec
- [NIT] no parent-cycle arm --> FIXED b795c5eec (cycle arm)
- [NIT] PUBLISHER global contract --> DEFERRED (both call sites read it only after true)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] tools/site-autodeploy.sh:310 - a wrong exemption would leave no record --> FIXED 39f90bae2 (every passed-over match is logged with the test above it; arm asserts the text)
- [NIT] `--test` alternative untested --> FIXED 39f90bae2 (bare node --test arm + mutant)
- [NIT] header line over width --> FIXED 39f90bae2
- [NIT] argv clause --> FIXED 39f90bae2 (comment states the constraint)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (header rewrap)
- [WARNING] tools/site-autodeploy.sh:84 - header still documented `ps -axo command=` --> FIXED e1d74c21d
- [NIT] long header line --> FIXED e1d74c21d
- [NIT] mixed test-then-real list untested --> FIXED e1d74c21d (mixed arm)
- [NIT] pass-over logged twice per tick --> DEFERRED (plan)
- [NIT] plan could name the node exemption more fully --> DEFERRED (weakest premise already does)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] tools/site-autodeploy.sh:313 - `bash -c 'tools/test-a.sh && bash tools/deploy-site.sh --publish'` counted as a test, passing over a real publish (unsafe direction) --> FIXED 18c260e7a (an ancestor whose own command names a publisher is not a test; shellc arm + mutant)
- [NIT] node arms did not assert the record --> FIXED 18c260e7a
- [NIT] pid ? naming untested --> DEFERRED (held by section 7's pid-less lines)
- [NIT] T line text not in plan --> FIXED 18c260e7a (plan)
- [NIT] duplicate log per tick --> DEFERRED (dup of iteration 4)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] tools/site-autodeploy.sh:~320 - the card's premise (tests run publishers against fakes) unstated --> FIXED a1525a612 (plan states it, with the evidence for the incident's test: stubbed vercel and curl)
- [NIT] node --test anywhere exempts --> DEFERRED (plan; follow-up #6912)
- [NIT] pid reuse in one snapshot --> DEFERRED (plan)
- [NIT] first arm's middle hop not publisher-named --> DEFERRED (shellc and mixed cover it)
- [NIT] mutants not visible in the diff --> noted (listed above)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 new actionable (its WARNING is iteration 6's premise, deduplicated), 4 NITs
**Self-generated:** 0
- [WARNING] premise rests on tests using fakes --> DUPLICATE of iteration 6 (DEFERRED with evidence; three more tests spot-checked clean by the reviewer)
- [NIT] real ps shape never tested --> FIXED 3283d6b89 (real-ps shape arm)
- [NIT] long comment line, packed awk loop --> FIXED 3283d6b89
- [NIT] node --test anywhere --> DUPLICATE
- [NIT] bash -n residual uncommented --> FIXED 3283d6b89 (plan)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 new actionable; 2 WARNINGs both duplicates (node --test anywhere; pid reuse), 3 NITs
**Self-generated:** 0
**Converged** - no new actionable findings. The two warnings are filed as follow-up #6912 per the 8-round rule.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/site-autodeploy.sh:284 | BRANCH | node suite's release.sh still held | FIXED | ae112d2d5 |
| 2 | 2 | WARNING | .claude/plans/autodeploy-6907.md:33 | SELF | plan predates node rule | FIXED | b795c5eec |
| 3 | 2 | WARNING | tools/site-autodeploy.sh:325 | BRANCH | argv in CI log | DEFERRED | publishers take version/flags; token from env |
| 4 | 3 | WARNING | tools/site-autodeploy.sh:310 | BRANCH | wrong exemption silent | FIXED | 39f90bae2 |
| 5 | 4 | WARNING | tools/site-autodeploy.sh:84 | BRANCH | header names old ps default | FIXED | e1d74c21d |
| 6 | 5 | WARNING | tools/site-autodeploy.sh:313 | BRANCH | test-then-publish shell exempted | FIXED | 18c260e7a |
| 7 | 6 | WARNING | tools/site-autodeploy.sh:320 | BRANCH | fakes premise unstated | FIXED | a1525a612 |
| 8 | 8 | WARNING | tools/site-autodeploy.sh:327 | BRANCH | node --test anywhere; pid reuse | DEFERRED | follow-up #6912 |

### NITs (non-blocking, across all iterations)
- [NIT] pass-over line written on both looks of a tick (iterations 4, 5)
- [NIT] pid ? naming has no dedicated assertion (iteration 5)
- [NIT] a command line with an embedded newline could forge a T/H record; arguments come from repo scripts (iteration 8)

### Strengths (across all iterations)
- Every ambiguous input fails closed: no pid, orphan, cycle, matcher failure, publisher-naming ancestor (iterations 1 to 8).
- The skip names its holder and every exemption is logged, so a mis-hold like the 10-22 one is readable from the job output (iterations 3, 6, 7).
- Tests assert outcomes in both directions with controls, each arm on its own state (iterations 1, 3, 7).

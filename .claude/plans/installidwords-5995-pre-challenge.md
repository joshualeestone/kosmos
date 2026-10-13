---
pre_challenge: true
method: challenge-loop
branch: installidwords-5995
diff_hash: 34dd3bcd5ec79c9b7bd32d948fb12ed93a8f38938a04f0fd22459f9002148181
validation: passed (the repo's full validation PASSED at e2a44938d, the reviewed head, finishing 2026-10-12 21:31 CDT: 19657 tests, 19422 passed, 0 failed, 235 skipped; shell suite 230 of 230 passed. That run was on the branch as it stands, which is behind main; a tree merged with main f7e6fc81c was checked separately: source-sweep guards 180 passed, every web*.test.js 2752 passed, this branch's own tests 418 passed. The suite against current main is PR CI)
subdir_audit: passed
timestamp: 2026-10-13T02:51:34Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (default, sonnet, default, sonnet, default, sonnet, default, sonnet)
**Converged:** Yes: iteration 8 found no blocker, no warning and no convention finding (3 NITs).
**Total new findings above NIT:** 0 BLOCKERs, 23 WARNINGs, 5 CONVENTIONs (counted from the lines below)
**Fixed:** 22 WARNINGs, 3 CONVENTIONs | **Not taken, with the reason in the plan:** 1 WARNING, 2 CONVENTIONs | **Asked (awaiting user):** 0

The full text of each finding and its answer is in `.claude/plans/installidwords-5995.md`, "Review 1" to "Review 8".

**Two things a reader must not miss:**
- The first version of the test checked the WORDING of comments ("never leaves"). It drew findings three rounds
  running, in both directions (true sentences flagged, real promises passed), so iteration 5 removed it. What the
  test holds now is four exact sets of file names: who mentions the identifier, who mentions the profile's copy, who
  loads `engine/ping.js`, and who names the id's file. It does not read what a comment says, and its header says so.
- The id still reaches the page inside every agent's card (`engine/status.js` serves the whole profile). That is NOT
  fixed here. It is the fifth finding on the card and has its own branch, `cardnoinstallid-5995`.

**Self-generated** below is my reading of each round against the commits before it, not a blame lookup per finding.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 6 WARNINGs, 1 CONVENTION
**Self-generated:** 0
- [WARNING] x6: "and to nobody else" was false; the test looked for a call and missed a property read; the scan was `engine/` only; the comment stripper could hide a real read; the beacon assertion passed on any non-empty string; the wording pattern missed five other wordings --> FIXED (ab88e216d)
- [CONVENTION] the header claimed the test holds which endpoints, and the test did not sandbox its data root --> FIXED (ab88e216d)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs
**Self-generated:** 2
- [WARNING] x4: `engine/ping.js`'s first sentence named one route above a list of two; the test matches the exact identifier, not every spelling (now said in the header, with the measurement); a wording with no full stop was missed (written as a known limit); the profile's line did not say a phone over Kosmos+ --> FIXED (706a6f8ca)

#### Iteration 3
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs
**Self-generated:** 3
- [WARNING] x4: the scan walked chosen folders and missed the native app, deploy scripts and git hooks (it asks git now); the wording check matched "install identity"; six more wordings; the feedback half matched source text (it writes a report in the sandbox now) --> FIXED (8a1bf8ad1)
- [CONVENTION] "one per install" is one per data root --> FIXED (8a1bf8ad1)
- [CONVENTION] a timestamp in the plan's file name --> NOT TAKEN (the plans beside it carry none; the gate finds a plan by branch name)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1
- [WARNING] a new file not yet added to git was not scanned --> FIXED (78e656c43)
- [WARNING] the test needs a git checkout --> NOT TAKEN (six sibling sweeps list files the same way; a skip would read as a pass)

#### Iteration 5
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION
**Self-generated:** 2
- [WARNING] x3: the wording check flagged true sentences and passed real promises (removed); "loads ping.js" matched one spelling of the path; nothing held a read of the id's file by name --> FIXED (00c18ce2e)
- [CONVENTION] the list's lines said when each file sends, incompletely (they say who now) --> FIXED (00c18ce2e)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION
**Self-generated:** 1
- [WARNING] x2: nothing holds what a profile reader does with the whole record (named in the header and Weakest premise; the guard that fits is on the served card, in the fifth finding's branch); the scan left out runnable browser checks under `docs/` --> FIXED (674f4e693)
- [CONVENTION] count only files already added to git --> NOT TAKEN (iteration 4 asked for the opposite and it was taken; the rule stays)

#### Iteration 7
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 1
- [WARNING] x2: a third comment made the same false promise, in `tools/test-install.sh`; the loader set saw only a literal path, not one built with `path.join` --> FIXED (27be3df7a)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0
- NITs only; one taken (e2a44938d): the recorded card's id is a fixed zero uuid, not blank, and the description says so.

### What this does not prove
- No test reads what a comment says. A fourth false promise worded in a file outside the four sets would not go red.
- A name built from pieces of the word `ping` is not seen by the loader set. The test's comment says so.

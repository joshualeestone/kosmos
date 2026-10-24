---
pre_challenge: true
method: challenge-loop
branch: named-promote-7005
diff_hash: 3b1b7656dee7553e0696383bfc8ab97e31b7b236e61401961aa1c222b20c4c6f
validation: passed (Mortals, 23597 tests, 0 fail, clean entry for this hash)
subdir_audit: passed
timestamp: 2026-10-24T02:29:28Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20 (blind reviewers rotated across opus, sonnet and fable)
**Converged:** Yes (iteration 20: both WARNINGs deduplicated against ledger entries; NITs only)
**Total actionable findings:** 39 WARNINGs, 3 CONVENTIONs, 0 BLOCKERs (plus NITs, many taken)
**Fixed:** 36 | **Deferred:** 6 (by design, documented) | **Asked:** 0

Every fix was shown red-capable by a mutant against tools/test-promote-named-7005.sh (pass count recorded; the
restored file returned ALL PASS each time). Neighbours green: test-setup-staging-5032, test-staging-channel-2036,
test-staging-wire-2036, test-setup-floor-6149, test-pointer-freeze, test-deploy-site-promote, test-promote-channel-win.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] promote-channel.sh selection - newest commit naming V could be an installer-less republish --> FIXED (18baa001af)
- [WARNING] no-installer hand fix pointed at the working tree's setup-staging --> FIXED (18baa001af)
- [WARNING] a mistyped older V could ride --force (no rollback guard) --> FIXED (18baa001af, --allow-older)
- [WARNING] tests missed several-commits, no-installer, gate-HOLD paths --> FIXED (18baa001af)

#### Iteration 2
**Reviewer model:** sonnet
**Self-generated:** 1 (the ${X:+a}${X:-b} messages were this loop's own text)
- [WARNING] named-mode messages ended in a stray version (${X:+a}${X:-b} is not an if/else) --> FIXED (ac2b74ccf8)
- [WARNING] agreement compared sha only --> FIXED (ac2b74ccf8)
- [WARNING] a commit never pushed could be chosen --> FIXED (ac2b74ccf8, origin/main check)

#### Iteration 3
**Reviewer model:** fable
**Self-generated:** 0
- [WARNING] a re-cut of V left no way forward --> FIXED (fb3d97eab0, --sha)
- [WARNING] "older than abc" was false for an uncomparable version --> FIXED (fb3d97eab0)
- [CONVENTION] docs/staging-channel.md did not document the mode --> FIXED (fb3d97eab0)

#### Iteration 4
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] post-force advice sent the check to the moved board --> FIXED (6b26ebd2a5)
- [WARNING] no re-verification before the write in named mode --> FIXED (6b26ebd2a5)
- [WARNING] --force not tied to bytes --> FIXED (6b26ebd2a5, --force needs --sha); also fixed the default path's doubled port

#### Iteration 5
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] hand fix offered a later cut's setup-staging beside a republish --> FIXED (fb54dc65d3)

#### Iteration 6
**Reviewer model:** fable
**Self-generated:** 1
- [WARNING] disagreement advice wrong for two shapes --> FIXED (18c619c005)
- [WARNING] %cs needs git 2.21+ --> FIXED (18c619c005)

#### Iteration 7
**Reviewer model:** opus
**Self-generated:** 1
- [WARNING] same-bytes/other-manifest dead end --> FIXED (8ba2bd0df0, --commit; rule kept strict, decision moved to the operator)
- [WARNING] a republish's other fields silently dropped --> FIXED (8ba2bd0df0, NOTE; refusal in iteration 8)

#### Iteration 8
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] rollback baseline read the working tree --> FIXED (c48884051f)
- [WARNING] a differing later pointer only noted --> FIXED (c48884051f, refuses until --commit)

#### Iteration 9
**Reviewer model:** fable
**Self-generated:** 1
- [WARNING] versionless prod pointer failed open --> FIXED (11d39852a0)
- [WARNING] two prod baselines in one run --> FIXED (11d39852a0, checkout latest.json must be origin's)

#### Iteration 10
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] numeric control could pass on its 1.0.0 fixture --> FIXED (9b15df8f9c)
- [WARNING] Kosmos+ gate input untested --> FIXED (9b15df8f9c)
- [WARNING] docs silent on dist-retention pruning V --> FIXED (9b15df8f9c)

#### Iteration 11
**Reviewer model:** sonnet
**Self-generated:** 0
- [WARNING] manifest read from dist/, not the commit --> DEFERRED: a re-sign after the cut is legitimate; documented, sha printed (iteration 14)
- [WARNING] plan top sections stale --> FIXED (158f7378cd)
- [WARNING] merge hold only in prose --> FIXED: stated in the PR body

#### Iteration 12
**Reviewer model:** fable
**Self-generated:** 1
- [WARNING] unpublished commit caused a false disagreement --> FIXED (11d0ebc1c2)
- [WARNING] same-version replacement unannounced --> FIXED (11d0ebc1c2, NOTE + docs)

#### Iteration 13
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] agent-spawn gate refused V for the moved board's build --> FIXED (e2e96476bc; narrowed in iteration 14)

#### Iteration 14
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] iteration 13's downgrade made a real wedge on V forceable --> FIXED (c526c312e9: downgrade only when the gate READ another version; pinned)
- [WARNING] manifest content not pinned --> DEFERRED (as iteration 11); manifest sha now printed

#### Iteration 15
**Reviewer model:** fable
**Self-generated:** 1
- [WARNING] same-build NOTE hid a differing installer --> FIXED (fbe67f4ee3)
- [WARNING] gate stderr merged into stdout in named mode --> FIXED (fbe67f4ee3)
- [WARNING] PARTIAL arm untested/undocumented --> FIXED (fbe67f4ee3)
- [CONVENTION] plan file name shape --> FIXED (renamed to named-promote-7005.md)

#### Iteration 16
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] a down/token-refusing board refuses V unforceably --> DEFERRED: the gate cannot read its build (iteration-14 rule); the suggested reorder was checked and changes nothing there; docs corrected (ad2aa29ac9)

#### Iteration 17
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] JSON.stringify replacer list hid nested differences --> FIXED (b1911aaf66, util.isDeepStrictEqual; test red on old code)

#### Iteration 18
**Reviewer model:** fable
**Self-generated:** 1
- [WARNING] agent-gate contract comment lacked the named exception --> FIXED (3f42ac999b)
- [WARNING] two notions of "has an origin" --> FIXED (3f42ac999b)

#### Iteration 19
**Reviewer model:** opus
**Self-generated:** 1
- [WARNING] a checkout behind origin could miss a re-cut of V --> FIXED (c1fe496f26, checkout must hold origin/main)
- [WARNING] downgrade message advised a hand check after --force was already given --> FIXED (c1fe496f26)

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (2 deduplicated: agent downgrade = iterations 14/18, confirmed resolved; manifest = iterations 11/14, deferred by design), 0 CONVENTIONs, 3 NITs
**Converged** - no new actionable findings.

### Deferred (by design, documented)
- [WARNING] manifest pair read from dist/ (iterations 11, 14, 20): a re-sign after the cut is legitimate; sha printed.
- [WARNING] a down or token-refusing board refuses (iteration 16): the gate cannot read its build; same rule as iteration 14.
- [NIT] a middle republish is not compared (needs a hand-edited pointer); origin/main hard-coded as elsewhere.
- [NIT] new test wired without a bash -n line, as test-setup-staging-5032.sh.
- [NIT] git log date order vs --topo-order: the site's pointer history is linear (0 merges measured).
- [NIT] final PROMOTED line keeps the default wording.

### Strengths (across iterations)
- [STRENGTH] Default path unchanged by construction (message variables default to the old text), pinned word for word by controls.
- [STRENGTH] Nothing unverified reaches prod: commit snapshot, artifact re-verified before the write, --force tied to --sha, one prod baseline.
- [STRENGTH] Every refusal in the 92-check test asserts prod and /setup untouched and has a control.

---
pre_challenge: true
method: challenge-loop
branch: iosshots-6262
diff_hash: 87e45c181dcdae1421b6fe6b89ab3f942e7866a4d35bc0722d521a5185b223f1
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T08:11:20Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (alternating Sonnet and Opus)
**Converged:** Yes (iteration 11 found nothing new; a post-convergence test fix and two more rounds followed; iteration 13 found nothing new)
**Total actionable findings:** about 48 WARNINGs and CONVENTIONs across 13 reviews, no BLOCKERs
**Fixed:** about 34 | **Deferred:** 11 (reasons below) | **Asked (awaiting user):** 0

Process notes, stated rather than hidden:
- Iteration 1's review was spawned while the initial validation was still running. That validation then failed on two
  timing tests in engine/manipcheck-5683.test.js (85/85 alone) under load, unrelated to this diff.
- After review findings changed the proxy or script, the screenshots were re-shot through tools/queued-heavy.sh so
  the filed pictures always come from the reviewed code. Re-shoots: 13 runs, of which 3 failed closed on a real defect
  (ECONNRESET, fixed with agent: false), 1 on my own self-gating bug (fixed with kosmos_holds_machine_claim), 1 on a
  missing heavy-gate turn, and the rest passed.
- Closing validation: run 1 caught a real defect (cli.sandbox-data-4796 refused the new test's inherited environment;
  fixed); runs 2 and the What's New branch's run hit #6362 (engine/codexhooks-5812.test.js temp dir, Baron's card,
  0 tests failed); run 3 on the final head PASSED (21673 tests, 0 fail, hash 87e45c181dcd).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 7 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] shots-proxy.js -- LAN listener let any machine reach the board as local --> FIXED (c0ee0a12): answers only this Mac
- [WARNING] shots-proxy.js -- event-stream chunks scanned one at a time --> FIXED (c0ee0a12): streams refused
- [WARNING] shots-proxy.js -- every text/html and media path skipped unread --> FIXED (c0ee0a12)
- [WARNING] ios.yml -- the upload path never ran the switch check --> FIXED (c0ee0a12): inside check-ipa-entitlements.sh
- [WARNING] check-no-shots-flag.sh -- control was a hand-made file --> FIXED (c0ee0a12): real build with the switch
- [WARNING] README.md -- said no app record and an open name --> FIXED (c0ee0a12)
- [WARNING] shoot-app.sh -- board shutdown not waited on --> FIXED (c0ee0a12)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 6 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2 (plan sentence; proxy comment)
- [WARNING] shoot-app.sh -- status bar and theme switch unchecked --> FIXED (fdf6a33a)
- [WARNING] shoot-app.sh -- an errored screen could skip the page guard --> FIXED (fdf6a33a): per-screen ok line required
- [WARNING] shots-proxy.js -- Transfer-Encoding beside Content-Length (a real parse error) --> FIXED (fdf6a33a)
- [WARNING] shots-proxy.js -- no error handling on a broken answer --> FIXED (fdf6a33a): UPSTREAM
- [WARNING] shots-proxy.js -- no automated test --> FIXED (fdf6a33a): ios.store-shots-proxy-6262.test.js
- [WARNING] shots-proxy.js -- reading source is stricter than the lib's use --> FIXED (fdf6a33a): said in the header
- [CONVENTION] plan -- "non-HTML" untrue --> FIXED (fdf6a33a)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 2 NITs
- [WARNING] check-no-shots-flag.sh -- 15-byte inline-string limit --> FIXED (429166c6): stated at the definition and the check
- [WARNING] ios.yml -- Release path unverified --> DEFERRED: read, ios/build/Release-iphonesimulator is built by the earlier step
- [WARNING] shots-proxy.js -- 403 path untested --> DEFERRED: needs a second source address; measured by hand

#### Iteration 4
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 6 NITs
**Self-generated:** 1 (README timestamps sentence, deleted)
- [WARNING] ios.yml -- control passed on a missing executable --> FIXED (434ceb46): found-it line required
- [WARNING] check-ipa-entitlements.sh -- two refusals worded alike --> FIXED (434ceb46)
- [WARNING] README.md -- timestamps sentence untrue of the pictures --> FIXED (434ceb46): deleted
- [WARNING] proxy test -- log pipe race --> FIXED (434ceb46): waits for the line
- [NIT] shots-proxy.js -- unanchored path swap --> FIXED (434ceb46) with a sibling arm

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 5 WARNINGs, 2 NITs
- [WARNING] check-no-shots-flag.sh -- single marker --> DEFERRED: duplicate of iteration 3, covered by the CI control
- [WARNING] shots-proxy.js -- any local process passes --> DEFERRED: grants nothing a local process lacks (plan)
- [WARNING] shots-proxy.js -- media passes unread --> FIXED (8667179e): only shipped files under web/
- [WARNING] shoot-app.sh -- late failure --> DEFERRED: fails closed; costs time only
- [WARNING] shoot-app.sh -- non-atomic swap --> FIXED (8667179e)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 9 NITs
- [WARNING] shoot-app.sh -- dead proxy or board not detected --> FIXED (915fc3e8)
- [WARNING] shots-proxy.js -- malformed % crashed the proxy --> FIXED (915fc3e8) with an arm
- [WARNING] shots-proxy.js -- non-media binaries read as text --> FIXED (915fc3e8): text allowlist

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs, 2 NITs
- [WARNING] marker rename --> DEFERRED: duplicate (iteration 3)
- [WARNING] shoot-app.sh -- whole-folder swap --> FIXED (5d6729af): per set
- [WARNING] shots-proxy.js -- no Host check --> FIXED (5d6729af) with a rebinding arm
- [WARNING] shipped rule "enforced" --> FIXED (5d6729af): said to be by path

#### Iteration 8
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 5 NITs
- [WARNING] chat shot "Nothing back yet." --> FIXED (6cc674ce): named in README for Josh
- [WARNING] charging battery vs comment --> FIXED (6cc674ce)
- [WARNING] encoded leaks --> FIXED (6cc674ce) with three arms
- [WARNING] swap across two runs --> FIXED (6cc674ce): restores a left set first

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs, 4 NITs
- [WARNING] headers unread --> FIXED (8e1f29eb) with an arm
- [WARNING] status rewrite silently skipped --> FIXED (8e1f29eb): STAGE line fails the run
- [WARNING] fixed settle --> DEFERRED: pictures read by eye before commit (plan)
- [WARNING] device-archive control --> DEFERRED: literal marker in any build (plan)
Between iterations 7 and 8 (found by a re-shoot, not a reviewer): ECONNRESET on reused keep-alive connections -->
FIXED (b2a8a31d), agent: false; two runs then passed.

#### Iteration 10
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 7 NITs
- [WARNING] status bar 9:41 vs message times --> FIXED (35bb2242): the run's own time
- [WARNING] device-archive control --> DEFERRED: duplicate (iteration 9)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 2 NITs
- [WARNING] request direction unread --> DEFERRED: requests stay on this Mac; pictures show answers
- [WARNING] local processes --> DEFERRED: duplicate (iteration 5)
- [WARNING] 6.3 rule's authority --> DEFERRED: Apple's page read twice and quoted verbatim, 2026-10-17
**Converged.** Then the closing validation caught #4796 (FIXED, be5c9465), which reopened the loop.

#### Iteration 12
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 7 NITs
- [WARNING] Origin/Referer, Location and path-escape untested --> FIXED (f93ba585) with arms
- [WARNING] mixed encodings --> FIXED (f93ba585): combined form, two arms

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 1 new WARNING (3 duplicates), 4 NITs
- [WARNING] req.pipe not torn down; no upgrade handler --> DEFERRED: the board uses no WebSockets (0 in web/index.html,
  no upgrade handler in server.js) and an upstream error already fails the run (UPSTREAM)
**Converged** -- no new actionable findings.

### Every mutation check
Each new test arm was shown red with its fix removed, and the file restored byte-identical (cmp): framing, LEAK,
UPSTREAM, sibling path, shipped media, malformed path and non-text, Host, encoded forms, headers, STAGE, the
Origin/Location rewrite, path escape, mixed encodings; the export check's shots-build arm; the CI control.

### NITs (non-blocking, selected)
- The 6.3-inch project room's first message is cut at the top (product behaviour; README).
- Swift `shotsOrigin` holds a URL, not an origin.
- shoot.sh's guard compares paths case-sensitively.

### Strengths (across all iterations)
- A compile-time switch, checked on the Release app, the archive, the exported .ipa, and by a real built-with-switch control.
- A proxy that fails closed on every uncertain answer, with each refusal named in the log and turned into a failed run.
- A listing check that can fail on the old set and requires the size Apple requires.

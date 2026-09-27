---
pre_challenge: true
method: challenge-loop
branch: twa-address-2854
diff_hash: 0231b8525fb4370f3960dba1c4115214fafecc7cc7ae6fc080b4537852cb402c
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T05:13:32Z
iterations: 15
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 15 (1 to 4 in an earlier session, recorded in the plan file; 5 to 13 in this run; 14 and 15 after the rebase onto main)
**Converged:** Yes, first at iteration 13, and again at iteration 15 after the rebase (its only WARNING deduplicated to a DEFERRED entry)
**Total findings this run (5 to 15):** 0 BLOCKERs, 17 WARNINGs, 3 CONVENTIONs, 34 NITs (as reported per iteration, repeats included)
**Fixed:** 11 ledger entries (plus 1 NIT) | **Deferred:** 6 ledger entries (#16 covers the same gap raised in 3 iterations) | **Asked (awaiting user):** 0

Rounds 1 to 4 findings and fixes are in `.claude/plans/twa-address-2854-20260926T0855.md`
("Challenge-loop round 3 changes", "round 4 changes"); their reviewer models were not recorded.

**Self-generated (6c-bis Origin) was NOT measured this run:** the blame lookup was not executed
per finding, so every Origin below is recorded BRANCH (the fail-safe value) rather than a count
filled in by judgement. Several round 8, 11 and 12 findings were plainly about code this loop
wrote in rounds 5 and 6 (noted per iteration), and each was a CODE finding fixed normally.

**Rebase after iteration 13:** main's #4093 (native load fallback) rewrote KosmosLauncherActivity
and the manifest. The 13 branch commits were squashed into one (old history kept on local branch
twa-address-2854-prerebase, tip c2724423a, 0-byte tree diff to the squash) and rebased once. The
launcher keeps all of #4093's fallback code plus this branch's getLaunchingUrl override; the
manifest keeps both sides. Every sha below before 9b723ed96 is pre-squash history. Iterations 14
and 15 reviewed the rebased commit 9b723ed96.

Validation: tools run on every fix commit. Android `:app:testDebugUnitTest :app:assembleDebug`
(gated): 18/18 through round 9, 19/19 from round 10 (new `theLauncherTakesOnlyHttpsOnTheCoordinator`),
last on the round 12 tree at 04:41Z. Full kosmos suite via validation-log (gated): clean for
d48ba8777 (hash 2a312aab), c8c64e6f5 (c634e3a3), e284644ab (76fd9944), c2724423a
(22da5f95, 04:56:57Z), and the rebased 9b723ed96 (0231b852, 05:13:27Z, via tools/heavy-gate.sh).
Android build and 19/19 JVM tests on the rebased tree at 05:00:56Z. Commit subjects were reworded after round 12 (tree unchanged, 0-byte diff),
so pre-reword shas above are the originals.

### Per-Iteration Breakdown

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** not measured
- [CONVENTION] OpenAddressActivity.java catch blocks swallowed failures at an exported boundary --> FIXED (e7a1dfc97, log the failure kind only)
- [WARNING] OpenAddressActivity.java fullScreen branch has no automated test --> DEFERRED: module has JUnit only; the value it branches on is tested both ways; on-phone checklist item

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] KosmosLauncherActivity.java exported launcher passed any non-sign-in host to the TWA, so an installed app could open a foreign Mac full screen with no nonce --> FIXED (eca49d712)
- [WARNING] OpenAddressActivity.java refusal opened a bare sign-in page without a nonce --> FIXED (eca49d712, later superseded in iteration 12)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] OpenAddressActivity.java rotation between onCreate and the TwaLauncher callback double-opens --> DEFERRED: not reachable in androidbrowserhelper 2.5.0 (bytecode read: launch and Runnable run back to back on the main thread; destroy() sets mDestroyed so an unmade launch is skipped)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (both warnings concern iteration 6 code)
- [WARNING] OpenAddressActivity.java data-less restart swallowed by LauncherActivity's alive-count guard, so a refused tap did nothing --> FIXED (28c0eed8f, later superseded in iteration 12)
- [WARNING] KosmosLauncherActivity.java guard compared only the host and passed the caller's string to Chrome --> FIXED (28c0eed8f, require https, rebuild from the configured host)
- [NIT] AddressChoiceTest.java lookalike characters as literal non-ASCII --> FIXED (28c0eed8f, \u escapes)

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] AndroidManifest.xml kosmos-open scheme can be squatted by another app --> DEFERRED: the page's intent names package=io.kosmos.app (kosmos-relay signin.html, pinned by signin.test.js intentFor); Chrome delivers a package-scoped intent only to that package
- [WARNING] OpenAddressActivity.java TWA launch not guarded for ActivityNotFoundException --> FIXED (e284644ab)
- [WARNING] KosmosLauncherActivity.java URL rebuild untested --> DEFERRED (reopened in iteration 10)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [WARNING] launcher guard and fullScreen branch untested --> FIXED in part (b5dfa1753): the earlier deferral reason held only for the Uri rebuild, so the decision is now AddressChoice.isSignInUrl with a JVM test; the rebuild and the activity branch stay DEFERRED
- [NIT] AddressChoice.java doc implied the account list authenticates --> FIXED (b5dfa1753)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the catch was added in iteration 5)
- [WARNING] OpenAddressActivity.java RuntimeException catch wrapped AddressChoice.choose --> FIXED (0ef04e6f7, narrowed to the extras reads)

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** not measured (the first warning concerns iteration 6 and 8 code)
- [WARNING] OpenAddressActivity.java refusal restarted the launcher and re-minted the nonce, so any page or app could silently downgrade the person's open sign-in page --> FIXED (c2724423a, a refusal now just finishes)
- [WARNING] OpenAddressActivity.java blank white window while TwaLauncher binds --> DEFERRED: the theme's windowBackground is @drawable/splash_screen with values-night variants
- [WARNING] Uri rebuild and activity branches untested --> DEFERRED (duplicate of iteration 10)
- [CONVENTION] AddressChoice.java raw "https://" and "/#kst=" literals --> FIXED (c2724423a, HTTPS and KST_FRAGMENT)
- [CONVENTION] commit subjects with parentheses, colons and a WIP --> FIXED (subjects reworded, tree unchanged)

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (untested activity code, DEFERRED)
**Converged** — no new actionable findings.

#### Iteration 14 (after the rebase)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** not measured
**Duplicates of prior findings:** 1 (untested activity code, DEFERRED)
- [WARNING] branch push rule (CLAUDE.md, never push onto a branch with an open or merged PR) --> DEFERRED: no PR exists for this branch (checked with a positive control); the remote holds only four earlier unreviewed commits, replaced with --force-with-lease --force-if-includes

#### Iteration 15 (after the rebase)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (untested activity code, DEFERRED)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 5 | CONVENTION | OpenAddressActivity.java | BRANCH | swallowed catches at exported boundary | FIXED | e7a1dfc97 |
| 2 | 5 | WARNING | OpenAddressActivity.java | BRANCH | fullScreen branch untested | DEFERRED | JUnit only; value tested both ways |
| 3 | 6 | WARNING | KosmosLauncherActivity.java | BRANCH | exported launcher opens foreign host without nonce | FIXED | eca49d712 |
| 4 | 6 | WARNING | OpenAddressActivity.java | BRANCH | refusal opened sign-in page without nonce | FIXED | eca49d712, superseded by #13 |
| 5 | 7 | WARNING | OpenAddressActivity.java | BRANCH | rotation double-open | DEFERRED | not reachable in TwaLauncher 2.5.0 |
| 6 | 8 | WARNING | OpenAddressActivity.java | BRANCH | data-less restart swallowed | FIXED | 28c0eed8f, superseded by #13 |
| 7 | 8 | WARNING | KosmosLauncherActivity.java | BRANCH | host-only guard, caller string passed through | FIXED | 28c0eed8f |
| 8 | 9 | WARNING | AndroidManifest.xml | BRANCH | kosmos-open scheme squatting | DEFERRED | package= on the page, test-pinned |
| 9 | 9 | WARNING | OpenAddressActivity.java | BRANCH | TWA launch no-browser crash | FIXED | e284644ab |
| 10 | 10 | WARNING | KosmosLauncherActivity.java | BRANCH | launcher guard untested | FIXED | b5dfa1753 (isSignInUrl tested) |
| 11 | 11 | WARNING | OpenAddressActivity.java | BRANCH | catch wrapped AddressChoice | FIXED | 0ef04e6f7 |
| 12 | 12 | WARNING | OpenAddressActivity.java | BRANCH | white window while binding | DEFERRED | splash drawable background |
| 13 | 12 | WARNING | OpenAddressActivity.java | BRANCH | refusal re-mints nonce, junk intent downgrades | FIXED | c2724423a |
| 14 | 12 | CONVENTION | AddressChoice.java | BRANCH | raw literals | FIXED | c2724423a |
| 15 | 12 | CONVENTION | commit history | BRANCH | commit subject format | FIXED | reworded, tree unchanged |
| 16 | 9,12,13,14,15 | WARNING | KosmosLauncherActivity.java | BRANCH | Uri rebuild and activity branches untested | DEFERRED | needs Robolectric; follow-up |
| 17 | 14 | WARNING | branch state | BRANCH | push rule for branches with a PR | DEFERRED | no PR exists; force-with-lease |

### NITs (non-blocking, across iterations 5 to 13)
- [NIT] KosmosLauncherActivity.java — commit() vs apply() for the nonce write (raised in 5, 6, 7, 8, 9, 10, 11, 12, 13)
- [NIT] AddressChoiceTest.java — assertEquals(true/false) instead of assertTrue/assertFalse (5, 7, 8, 11, 12)
- [NIT] HandoffNonce.java — String.format without Locale.ROOT (5)
- [NIT] README — whether a fragment-only relaunch refreshes the page's stored nonce (6)
- [NIT] KosmosLauncherActivity.java — PREFS and PREF_NONCE lack doc comments (9, 11)
- [NIT] KosmosLauncherActivity.java — empty fragment counts as present (12)
- [NIT] android.yml — pin the expected AddressChoiceTest count, not just >= 1 (12)
- [NIT] AddressChoiceTest.java — no {null, null} nonce row (12)
- [NIT] OpenAddressActivity.java — variable name `in` (13)
- [NIT] OpenAddressActivity.java — could be `final` like the other two activities (14, 15)
- [NIT] AddressChoice.java — isSignInUrl sits in AddressChoice only because that class is JVM-tested (14)
- [NIT] HandoffNonce.java — per-byte String.format for hex (14)

### Strengths (across iterations)
- AddressChoice and HandoffNonce are pure Java with adversarial JVM tests that match the iOS table case for case (5 to 13)
- The CI step fails on a missing report, zero tests, failures, errors or skips (5 to 13)
- The round-4 correction (no nonce, no TWA) and the URL rebuild in the launcher close the paths a foreign Mac could use to go full screen (8, 10, 12)
- Logging at exported boundaries names the failure kind only, never the token or the address (7)

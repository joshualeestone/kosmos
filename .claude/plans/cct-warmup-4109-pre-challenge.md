---
pre_challenge: true
method: challenge-loop
branch: cct-warmup-4109
diff_hash: f708ac556bc4c36116f94173f7b275b1fe7bbf18014133bd73fbbdfec81154c1
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T09:05:23Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes, at iteration 4
**Total findings:** 0 BLOCKERs, 9 WARNINGs, 4 CONVENTIONs, 23 NITs (across iterations)
**Fixed:** 13 actionable (all WARNINGs and CONVENTIONs) plus several NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full suite after iteration 3's fixes, gated on tools/heavy-gate.sh --twice: 10719 tests,
10556 pass, 0 fail. Android unit tests (21) pass; the new BrowserWarmupTest fails on a mutant that
drops the recreate check.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 3 CONVENTIONs, 8 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] KosmosLauncherActivity.java:110-115: mayLaunchUrl runs on our own session, so the TWA launch cannot use the preload; putting it on the launch session would preload without the handoff nonce --> FIXED (06fb24de6): mayLaunchUrl removed, README explains both
- [WARNING] KosmosLauncherActivity.java:44: warmup also fires when Browser Helper finishes without launching (recreation) --> FIXED (06fb24de6): skipped when recreated
- [WARNING] evidence: effect not shown larger than the noise; alternating run not committed --> FIXED (df5512566): alternating session 3 run and committed
- [WARNING] KosmosLauncherActivity.java:105-129: behaviour change without tests --> FIXED (06fb24de6): shouldWarm extracted and unit-tested, mutation control red
- [CONVENTION] .claude/plans/: no plan file --> FIXED (06fb24de6)
- [CONVENTION] committed __pycache__ bytecode --> FIXED (06fb24de6): removed, ignored
- [CONVENTION] android/README.md: launcher paragraph not updated --> FIXED (06fb24de6): Browser warmup section
- NITs: Javadoc on warmup gating, bind priority / bindService false still needs unbind (FIXED), hasInternetNetwork called repeatedly, binding held for the TWA session, harness docstring and empty screencap (FIXED), tsv column provenance (FIXED in README), hard-coded runner paths and boot loop (boot loop FIXED)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (evidence files cited; their lines were written by commits outside ITER_COMMITS or are file-level)
- [WARNING] evidence .tsv: session 1 files lack the capture interval column --> FIXED (df5512566): provenance stated in the evidence README
- [WARNING] android/README.md: "before and after" pointed at an after that did not exist yet --> FIXED (df5512566): session 3 results committed
- [NIT] fully qualified ComponentName --> FIXED (df5512566)
- [NIT] savedInstanceState as a coarse proxy for Browser Helper's early finish

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 9 NITs
**Self-generated:** 4 of the above (the evidence README and plan lines were written by loop commits df5512566 / 2454ca573)
- [WARNING] evidence README: the leak count could not fail (force-stop skips onDestroy) --> FIXED (fb499e2c1): claim removed, stated as not measured
- [WARNING] evidence README: the run logs were .gitignored (*.log) --> FIXED (fb499e2c1): committed as .txt
- [WARNING] evidence README: stated range (0.1 to 0.25 s) excluded the stated headline (-281 ms) --> FIXED (fb499e2c1): headline is -181 ms over unloaded rounds, range 0.1 to 0.2 s
- [WARNING] evidence README and plan: the warmup arm's loaded round (a) was not disclosed --> FIXED (fb499e2c1): per-round table
- NITs: recreation wording (FIXED), binding held and priority, README section split (FIXED), harness TypeError and hung am start (FIXED), frame naming sentence (FIXED), control "only the APK changed" (FIXED), "about 40 lines" (FIXED), hard-coded paths

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] KosmosLauncherActivity.java:108-110: pickProvider runs before the cheap restored/online checks
- [NIT] KosmosLauncherActivity.java:44,110: hasInternetNetwork called twice per cold onCreate
- [NIT] KosmosLauncherActivity.java:44: Browser Helper's other early-finish paths still bind and unbind at once
**Converged:** no new actionable findings. Every number in the READMEs and plan was recomputed from the committed data and matched.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | KosmosLauncherActivity.java:110 | BRANCH | mayLaunchUrl on a separate session; nonce hazard | FIXED | 06fb24de6 |
| 2 | 1 | WARNING | KosmosLauncherActivity.java:44 | BRANCH | warmup on recreation | FIXED | 06fb24de6 |
| 3 | 1 | WARNING | evidence | BRANCH | effect not shown above noise | FIXED | df5512566 |
| 4 | 1 | WARNING | KosmosLauncherActivity.java:105 | BRANCH | no tests | FIXED | 06fb24de6 |
| 5 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | 06fb24de6 |
| 6 | 1 | CONVENTION | __pycache__ | BRANCH | committed bytecode | FIXED | 06fb24de6 |
| 7 | 1 | CONVENTION | android/README.md:58 | BRANCH | launcher docs not updated | FIXED | 06fb24de6 |
| 8 | 2 | WARNING | evidence .tsv | BRANCH | column provenance | FIXED | df5512566 |
| 9 | 2 | WARNING | android/README.md:60 | SELF | before/after claim ahead of data | FIXED | df5512566 |
| 10 | 3 | WARNING | evidence README:37 | SELF | leak count could not fail | FIXED | fb499e2c1 (claim deleted) |
| 11 | 3 | WARNING | evidence README:57 | SELF | logs gitignored | FIXED | fb499e2c1 |
| 12 | 3 | WARNING | evidence README:9 | SELF | range excluded headline | FIXED | fb499e2c1 |
| 13 | 3 | WARNING | evidence README:30 | SELF | warm arm load not disclosed | FIXED | fb499e2c1 |

### NITs (non-blocking, left as is)
- pickProvider before the cheap checks; hasInternetNetwork twice; Browser Helper's other early-finish paths bind and unbind at once (iteration 4)
- the warm binding is held for the whole TWA session and waives priority (iterations 1 and 3)
- the runners hard-code paths on the Mortals Mac (iterations 1 and 3; stated in the evidence README)

### Strengths
- The exported activity's URL validation and handoff nonce are untouched: the warmup reads no intent data (iterations 1, 3, 4)
- shouldWarm is a pure function, tested one argument at a time, and picked up by CI's per-report check (iterations 2, 4)
- Every javap claim and every quoted median was independently recomputed and matched (iterations 3, 4)

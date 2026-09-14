---
pre_challenge: true
method: challenge-loop
branch: mobile-718
diff_hash: b89bd34393e4008546589a68c26ee24cae6d537dfef5152a8a72ce074975ffdf
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T01:28:29Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (plus two out-of-band findings from a peer reviewer, folded in)
**Converged:** Yes (iteration 3 raised no new actionable findings)
**Total findings:** 12 (0 BLOCKERs, 5 WARNINGs, 3 CONVENTIONs, 4 NITs)
**Fixed:** 8 | **Deferred:** 3 (with reasoning) | **Asked:** 0

Change under review: the first mobile surface in the repo, a new `android/`
Trusted Web Activity skeleton (plus a branch plan file and one additive
`package.json` test:shell line). Validation is fully green on the rebased HEAD
(6234 tests, 6225 pass, 0 fail); the APK builds green under the box default
JDK 26 via the daemon-JVM pin.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (skeleton under review is the branch's own new code)
- [WARNING] tools/print-signing-fingerprint.sh: hardcoded debug storepass broke the documented release-keystore path --> FIXED
- [WARNING] .gitignore: `!/tools/**` negation re-exposed *.jks/*.keystore --> FIXED
- [CONVENTION] .claude/plans/: no plan file for the branch --> FIXED (plan file added)
- [NIT] mipmap-*: three density buckets shared one oversized icon --> FIXED (scaled per density)
- [NIT] .gitignore: redundant `app/build/` under `build/` --> FIXED

#### Peer findings (out-of-band, folded into the loop)
- [WARNING] gradle.properties/build: green build was not reproducible; the JDK-21 requirement lived only in the shell env --> FIXED (pinned the Gradle daemon JVM via `gradle-daemon-jvm.properties` toolchainVersion=21 + installations path; verified green launched under the default JDK 26)
- [WARNING] tools/print-signing-fingerprint.sh: release password passed in keytool argv, world-readable in `ps` --> FIXED (funnel through env, `-storepass:env`; verified the modifier is supported by this JDK's keytool)

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per kosmos#2032)
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs (+ 1 CONVENTION resolved at PR title)
**Self-generated:** 0 acted on as SELF
- [WARNING] gradle.properties: box-specific absolute JDK path in a tracked file --> DEFERRED: inherent Gradle 8.9 daemon-criteria limitation (no daemon auto-download); it is the deliberate this-box shortcut that makes the build-from-clone deliverable work, fails soft to auto-detection elsewhere, and the README spells out the CI / other-machine path.
- [WARNING] package.json: new script missing from the `test:shell` bash -n gate (convention #1) --> FIXED
- [CONVENTION] plan file: em dashes (Kano convention forbids them) --> FIXED
- [CONVENTION] first commit subject not in `<branch> -- <msg>` format --> RESOLVED at the PR title: the repo squash-merges, so the PR title is what lands on main; per-commit reword deferred as unnecessary.
- [NIT] gradle-wrapper.properties: no `distributionSha256Sum` pin --> DEFERRED: worth adding only with a checksum verified from Gradle's official source; the wrapper jar itself is genuine.
- [NIT] README layout tree omitted `gradle-daemon-jvm.properties` --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 actionable (1 WARNING was a duplicate of the deferred iter-2 finding; 1 new NIT; 1 duplicate NIT)
**Self-generated:** 0
- [WARNING] gradle.properties path --> DUPLICATE of the deferred iteration-2 finding; the reviewer itself concluded "documented tradeoff rather than a defect"
- [NIT] AndroidManifest allowBackup=true (immaterial for a data-less TWA) --> FIXED (set false, explicit for a network-only shell)
- [NIT] no adaptive icon (mipmap-anydpi-v26) --> DEFERRED: fine for a skeleton; add before a real Play listing
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for branch | FIXED | plan file added |
| 2 | 1 | WARNING | tools/print-signing-fingerprint.sh | BRANCH | Hardcoded storepass broke release path | FIXED | env-var precedence |
| 3 | 1 | WARNING | android/.gitignore | BRANCH | `!/tools/**` re-exposed keystores | FIXED | negation removed |
| 4 | 1 | NIT | mipmap-* | BRANCH | Oversized shared density icon | FIXED | scaled per density |
| 5 | 1 | NIT | android/.gitignore | BRANCH | Redundant app/build/ | FIXED | removed |
| 6 | P | WARNING | gradle.properties | BRANCH | Build not reproducible (shell-only JDK pin) | FIXED | daemon-JVM criteria |
| 7 | P | WARNING | tools/print-signing-fingerprint.sh | BRANCH | Release password in argv (ps side channel) | FIXED | -storepass:env |
| 8 | 2 | WARNING | gradle.properties | BRANCH | Box-specific JDK path in tracked file | DEFERRED | documented tradeoff |
| 9 | 2 | WARNING | package.json | BRANCH | Script missing from test:shell gate | FIXED | added bash -n entry |
| 10 | 2 | CONVENTION | plan file | BRANCH | Em dashes | FIXED | removed |
| 11 | 2 | CONVENTION | commit 1 subject | BRANCH | Not `<branch> -- <msg>` format | RESOLVED | PR title (squash-merge) |
| 12 | 3 | NIT | AndroidManifest.xml | BRANCH | allowBackup implicit true | FIXED | set false |

### Deferred items (for operator override)
- gradle.properties box-specific JDK path: a Gradle 8.9 daemon-criteria limitation; fails soft, documented for CI / other machines. Closed for real once Gradle gains daemon auto-download or CI provisions JDK 21.
- distributionSha256Sum: add with a checksum verified from Gradle's official source.
- Adaptive launcher icon: add before a real Play listing.

### Strengths (across all iterations)
- JDK daemon pin done the blessed way (Gradle's own `updateDaemonJvm` output), verified green launched under the incompatible default JDK 26.
- Digital Asset Links implemented on both halves (app-side asset_statements + website-side template), matching Bubblewrap's shape; escaped JSON parses.
- Signing-fingerprint tool keeps the release password out of the process table (`-storepass:env`), the exact side channel the repo guards against elsewhere.
- Purely additive change (isolated `android/` dir + plan file + one test:shell line); no regression surface, no secret committed.

### Note on validation
The full suite reds earlier (3 `#2808 runtime` tests) were a fixture-name collision between the test's `fleet.agent('liukang')` and the live Liu Kang agent on this multi-agent box, verified failing identically on the main checkout. That fixture was renamed and merged (PR #2857); this branch was rebased onto that main, after which the suite is fully green (0 fail). No proof was written over the earlier red.

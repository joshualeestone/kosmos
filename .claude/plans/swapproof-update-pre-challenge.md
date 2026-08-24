---
pre_challenge: true
method: challenge-loop
branch: swapproof-update
diff_hash: e2e37ba47f9eb27f7c8f262f540eb531a0351d94534c1aeee616fa3dc09dae86
subdir_audit: passed
timestamp: 2026-08-24T16:32:49Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (bounded to two in the plan; the round's findings were all fixed and the loop converged in one)
**Converged:** Yes
**Total findings:** 6 (0 BLOCKERs, 4 WARNINGs, 2 NITs), all fixed
**Fixed:** 6 | **Deferred:** 0

### The incident this branch answers

Josh's in-app update 0.5.12 to 0.5.13 printed downloading 100%, installed
to the destination, and done, while the disk kept 0.5.12, launchd's board
job was not running, and an unsupervised board kept serving the old
version. The artifact URL is one name across releases, so any cache
between a machine and the host can satisfy it with the prior release's
bytes and their matching checksum; and the update's error line numbers
matched no recent revision of setup.sh, evidence the machine may have
executed a STALE INSTALLER SCRIPT through the same cache. Every guard in
this branch holds whatever the transport: the run must PROVE what landed.

### The build (pre-round)

- setup.sh resolves the release pointer first (cache-busted on http(s),
  plain on file://); the log opens naming the version and time.
- Artifact fetches prefer versioned names, falling back to version-tied
  cache-busting queries; checksums ride the same URL arm; KOSMOS_SRC
  (explicitly chosen bytes) is exempt from target assertion.
- POST-SWAP READ-BACK: the installer reads the DESTINATION's version
  after the renames and dies naming both versions on a mismatch.
- The pause proves the old board gone BY PORT (lsof, ten seconds of
  grace, survivor named by pid; degrades without lsof), set-e-proof
  after the harness caught the bare substitution dying silently on the
  GOOD case (lsof exits 1 for nothing-listening).
- The keep-running step no longer prints success over a failed launchd
  bootstrap.
- engine/update.js's fetch of /setup carries the version buster (the
  script rides the same cache as the bytes).
- tools/release.sh publishes the versioned pair.
- tools/test-install.sh gains seven pins including the wedge reproduced
  in miniature (pointer ahead, only old bytes reachable: refuse, name
  both versions, never print the success line). The branch's harness
  failure set exactly equals clean main's environment baseline.

### Iteration 1 (bounded, final): 4 WARNINGs, 2 NITs, all fixed

- [WARNING] my rewritten release suite gate was dead code on the red
  path (subshell trips errexit before the captured exit is read;
  measured: exit 3, nothing printed) --> FIXED: || captures the exit,
  the summary prints, the log is named. CORRECTED CLAIM folded in: the
  ORIGINAL gate was protected by pipefail and refused correctly but
  silently; my earlier report that a red suite could have released was
  read from the pipe's shape, not measured, and the PM's probe plus
  this round's independently proved it wrong. The comment at the gate
  now records the true story.
- [WARNING] the TARGET_VERSION extraction could die silently via
  SIGPIPE on a garbage 200 pointer (measured: exit 141, no sentence)
  --> FIXED: guarded to degrade to the versionless run.
- [WARNING] re-cutting the same version with different bytes would
  recreate the incident one level up under a name installers treat as
  immutable --> FIXED: release refuses to republish a versioned
  artifact with different bytes.
- [WARNING] the plan claimed verify-served checks the versioned pair;
  it did not --> FIXED: it does now (missing pair fails the verify,
  naming the silent demotion it would cause).
- [NIT] stale three-tries comment --> FIXED. [NIT] trailing space in
  the pid die --> FIXED.

### Validation
Full suite green (validation-log PASSED, hash e2e37ba47f9e), subdir
audit passed, tools/test-install.sh failure set identical to clean
main's environment baseline with all seven wedge pins green, and
engine/update.test.js 19/19. No em dashes in any added line.

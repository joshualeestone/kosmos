---
pre_challenge: true
method: challenge-loop
branch: staging-channel-wire-2036
diff_hash: d28098c547beb221c1be892bd829ead56ce27ead36480354bec92c5b8397c74b
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T15:31:30Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Fixed:** 1 BLOCKER + 2 WARNINGs + 4 NITs | **Deferred:** 1 NIT | **Asked:** 0

#2036 remainder: wire the merged standalone halves (#2063 fresh-user verify, #2077 pointer/promote,
#2089 sourceChannel) into the cut so a build reaches prod only via a fresh-user-verified pointer
promote, never directly (the 0.6.25 outage class). Model A: one host, two pointers (latest.json prod
/ latest-staging.json staging), promotion points prod at the same bytes. This PR wires PUBLISH
(release.sh), CONSUME (update.js + setup.sh -- the client update path), the abort cleanup, and the
promote alias-refresh. 🛑 DEFAULT IS PROD: the whole mechanism is opt-in and the default does not
move to staging until the loop is proven end-to-end on a real fresh machine (Splinter's invariant).

### Per-Iteration Breakdown

#### Iteration 1 - 1 BLOCKER, 1 WARNING, 1 NIT
- [BLOCKER] verify-served.sh did not read KOSMOS_VERIFY_POINTER (I passed it from release.sh but
  never edited verify-served.sh), so a staging cut's step 9 checked prod (still prior) and could
  never complete --> FIXED: verify-served.sh reads KOSMOS_VERIFY_POINTER (default latest.json,
  prod unchanged) + test arms (behavioral + source guards that it reads the var and uses $POINTER).
- [WARNING] the hand-off print used a bare $HOST (unbound under set -u) --> FIXED (${HOST:-...}).
- [NIT] update.js read only AGENT_WORKFORCE_UPDATE_CHANNEL; KOSMOS_UPDATE_CHANNEL on an existing box
  would be silently ignored by the auto-updater --> FIXED (reads either; test covers the fallback).

#### Iteration 2 - 1 WARNING, 1 NIT
- [WARNING] a staging cut overwrote the shared unversioned prod alias kosmos-arm64.tar.gz with
  staging bytes (release.sh:715, unconditional) -- a prod-reachable URL --> FIXED: gate the alias
  publish on a prod cut (a staging cut leaves the prod alias); promote-channel.sh refreshes the
  alias to the promoted bytes (the alias moves on promote). Behavioral promote test (alias created,
  bytes == the versioned artifact, sidecar verifies) + source guards.
- [NIT] the step-9 prod-unchanged assertion was fail-open (an empty curl passed silently) --> FIXED
  (empty read reported inconclusive, backed by the structural guarantee).

#### Iteration 3 - CONVERGED
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] promote alias derivation could NOTE-and-exit-0 (silent success with a stale/wrong alias)
  on a malformed artifact name --> FIXED: recompose-check the artifact against kosmos-<V>-<arch>
  and REFUSE (exit 1) rather than report success with a stale prod alias.
- [NIT] the abort restore loop checks out a tracked latest-staging.json on ANY channel's abort
  --> DEFERRED: it is parity with the existing latest.json/setup.sha256 behavior and bounded by
  the cut-load/machine-claim no-concurrent-cut guards; the reviewer called it parity, not a new
  hazard.
Five STRENGTHs independently confirmed: the default-PROD path is byte-for-byte unchanged across
release.sh/verify-served.sh/update.js/setup.sh/promote-channel.sh (could not be broken); the alias
is coherent across cut+promote and the promote alias-refresh runs only AFTER the pointer promote is
confirmed; the abort-restore handles all three cases; the client-path no-split-brain (update.js
forwards the resolved channel to the spawned setup.sh) is correct; tests are red-capable both ways.

### Outstanding questions (ASKED)
None.

### Deferred
- The restore-loop widening (iter 3) -- parity with existing behavior, bounded by the
  no-concurrent-cut guards.

### Strengths (across iterations)
- The default-PROD invariant (Splinter's) is provably byte-for-byte unchanged; the whole mechanism
  is opt-in, and the default-flip is a separate proof-gated follow-up after a real fresh-machine demo.
- The client update path (the 0.6.25-class-sensitive surface) has no split-brain: update.js and the
  spawned setup.sh read the SAME channel pointer, and the pointer names a versioned artifact so
  staging and prod pull different immutable bytes; safe fall-to-prod on empty/malformed.
- The prod alias tracks prod bytes: staging cut leaves it, prod cut + promote update it.
- Every fix carries a red-capable test; drift guards pin the extracted shell copies to source.

### Design decisions (documented; Josh can steer -- see the plan file)
- MODEL A (two pointers, one host), full loop in one PR, DEFAULT PROD until the loop is proven on a
  real fresh machine, manual promote by default. All confirmed by Splinter 2026-09-04.

### Validation
`node --test engine/update.test.js` 23/23; `bash tools/test-staging-wire-2036.sh` 20/20;
`bash tools/test-staging-channel-2036.sh` ALL PASS; `bash tools/test-release-detached.sh` 0 failures.
All default paths verified byte-for-byte prod. Branch rebased onto origin/main (clean) before this
proof. Wired into package.json test:shell.

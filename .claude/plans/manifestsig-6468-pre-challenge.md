---
pre_challenge: true
method: challenge-loop
branch: manifestsig-6468
diff_hash: e272555fa0b7ce962930620ddf24b6f37888172a4773e3b8b912796cc67d10b0
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T11:16:06Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind reviews, alternating opus and sonnet
**Converged:** Yes (iteration 8, sonnet: NITs only)
**Total findings:** 2 BLOCKERs, 15 WARNINGs, about 20 NITs
**Fixed:** all BLOCKERs and WARNINGs except those deferred as stated limits | **Asked (awaiting user):** 0

Validation after rebasing onto origin/main (0b6914f274): the 74 node test files that read install/setup.sh,
release.sh, test-install.sh, build-kosmos-bundle.sh, promote-channel.sh, verify-manifest.sh or the shell test list:
1490 pass, 0 fail, 13 skipped. Shell: test-bundle-names-6468, test-staging-channel-2036, test-setup-staging-5032,
test-staging-wire-2036, test-setup-floor-6149, test-promote-channel-win, test-cut-sign-preflight,
test-node-runtime-cache all pass. Earlier on this branch: the 60 shell tests that read release.sh or manifests,
59 pass and 1 SKIP (test-install-gate-control: no built dist).
Real-key arms (not in CI, no key there): the served 0.7.56 tarball and manifest, signed with the real key, pass the
installed verifier (pre and post) and tools/verify-manifest.sh with KOSMOS_REQUIRE_SIG=1; one byte appended to
app/server.js is refused. The build's own manifest writer, run on the 0.7.56 tree with the new parse, reproduces the
served 0.7.56 manifest entry for entry (362).
Not run: tools/test-install.sh end to end and a real cut (both need a built, signed bundle; the next cut on Mortals is
the measurement).

## Final ledger
### Iteration 1 (opus): 2 BLOCKERs, 3 should-fix, nits
- [BLOCKER] the archive could plant a link that the manifest download wrote through (FIXED: fetched to a mktemp folder
  outside the stage; the archive's sha and signature checked BEFORE tar; arm with planted links)
- [BLOCKER] the not-older check read VERSION, which is not a bare version, so it never fired (FIXED: installed
  app/package.json via the installed verifier; unreadable refuses; real-shaped VERSION in fixtures)
- [WARNING] tmux is fetched and run earlier (DEFERRED: stated limit)
- [WARNING] nothing checked the SERVED .sig (FIXED: verify-manifest.sh verifies it, required on a cut)
- [WARNING] promote did not check the .sig (FIXED)
- [NIT] unpinned real key arm (FIXED), channel binding (DEFERRED: stated), NODE_OPTIONS (FIXED: env -u + arm)
### Iteration 2 (sonnet): 0 BLOCKERs, 2 should-fix
- [WARNING] exit 3 (no key pinned) at pre led to a refusal at post (FIXED: _UM_NOKEY, two-phase arm, mutant red)
- [WARNING] promote failed open when prod's manifest was missing or unparseable (FIXED: needs-sig exit 2 = refuse)
- [NIT] post-branch cleanup (FIXED), channel switch refused as older (DEFERRED: stated on the card), replay of an
  older signed release still at or above the installed one (DEFERRED: stated), 1c reads the checkout's key list
  (NOTED: same commit as the frozen tree; sign re-checks), verb typo hits the key loader first (FIXED)
### Iteration 3 (opus): 0 BLOCKERs, 2 should-fix
- [WARNING] the install-gate control could never pass (its copy lacked engine/; no key elsewhere) (FIXED: copies
  engine/; a no-key skip is exit 3, cannot answer)
- [WARNING] promote and served-check shell logic untested (FIXED: 5 promote arms in test-staging-channel-2036.sh, a
  mutant swapping the needs-sig arms goes red; 3 served-check arms; real-key served run on 0.7.56 passes)
- [NIT] no-target arm asserted only the exit (FIXED), build could ship a symlink or an odd name (FIXED: the build
  refuses), verify-manifest's node (FIXED, and NODE moved above its first use, which set -u would have killed),
  rollback named in Limits (FIXED)
### Iteration 4 (sonnet): 0 BLOCKERs, 1 should-fix
- [WARNING] the build guard missed CR, NBSP and newline names that the manifest parser still bent (FIXED at the
  cause: names must be plain (a whitelist the whole 0.7.56 tree already meets, 362/362) and the parser takes
  "<64 hex>  <name>" by position with IFS= read -r; measured: it reproduces the served 0.7.56 manifest exactly)
- [NIT] first guard could SIGPIPE under pipefail (FIXED: || true), _UM_NOKEY not reset at pre (FIXED), the bad-.sig
  promote arm accepts any verify failure (NOTED: the Ss5 control shows the rest runs)
### Iteration 5 (opus): 0 BLOCKERs, 1 should-fix
- [WARNING] the name guard's `| head -3)" || _odd=""` threw the names away when SIGPIPE failed the pipe under pipefail
  (3000 offenders passed) (FIXED: kosmos_bundle_odd_names lists every offender in full, no head in a pipe;
  tools/test-bundle-names-6468.sh lifts it out and runs 5 arms incl. 3000 names; the old shape, run as a control,
  loses all 3000; registered in package.json test:shell)
- [NIT] verify-manifest.sh read names without IFS= (FIXED), stale guard comment (FIXED), prod manifest name not
  reject_pathy-checked in promote (FIXED), the key's map row named the wrong file (FIXED on both Macs)
- Self-caught while fixing: a test-only env switch that would have skipped the guard in a real build; removed before
  commit (the test lifts the function instead).
### Iteration 6 (sonnet): 0 BLOCKERs, 1 should-fix
- [WARNING] a newline in a FOLDER name split into pieces that each looked plain, so nothing was flagged (FIXED: names
  with a newline are found by name, find -name $'*\n*' -print0; arm added; a mutant disabling it goes red)
- [NIT] a missing stage or part read as "no offenders" (FIXED: each is an offender; two arms)
### Iteration 7 (opus, whole branch): 0 BLOCKERs, 2 should-fix
- [WARNING] the install harness signed with the REAL key wherever it ran (any branch, the shared Mac), minting trusted
  updates (FIXED: a throwaway key; the sandboxed install's verifier is set to pin it; nothing in the harness reads
  the secrets map now; measured on the real 0.7.56 manifest: the patched verifier accepts, the shipped one refuses)
- [WARNING] every release-side check asked whether the key is pinned in the CHECKOUT, not in the installs out there;
  a key rotation would pass every check and strand every install (FIXED: the build records pinned_keys in the signed
  manifest; 1c refuses a key the served prod or staging release does not pin; promote verifies under prod's current
  pinned_keys; manifest-sign.js check-served / verify-under, 3 test arms each way)
- [NIT] the gate control's second copy lacked engine/ (MOOT: the harness no longer needs it; control back to main's)
- [NIT] a verifier with its runtime gone said "predates signed releases" (FIXED: says the runtime is missing; arm)
### Iteration 8 (sonnet): no BLOCKER or WARNING findings (converged)
- [NIT] an empty pinned_keys could ship if reading them failed (FIXED after convergence, 2 lines: the build stops)
- [NIT] only served releases are read; retiring a key must wait until no release pinning only it is in use (DOCUMENTED in manifest-sign.js)
- [NIT] harness partial rewrite, pointer parsed by sed in promote, origin/main vs deployed (ACCEPTED as is)

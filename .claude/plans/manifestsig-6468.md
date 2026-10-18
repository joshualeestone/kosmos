# manifestsig-6468: signed release manifests, checked by the installed copy (#6468 ask 2)

## Finished looks like
Every release from this one on publishes kosmos-<V>-arm64.manifest.json.sig beside its manifest, and a Mac install
running this release refuses any later update whose manifest is not signed by a pinned key, whose files or tarball
differ from it, or whose version is older than the installed one, before anything in the update runs.

## Decided (card #6468 comment 6248247645)
- One ed25519 key, used for nothing else. Release copy on Mortals (the cut host; every recent manifest says
  built.host Mortals-Mac-mini), backup copy on Agent1s, both filed via /add-secret as kosmos-manifest-signing.
- Public keys pinned as a LIST in engine/manifest-verify.js (ships as engine/*.js).

## Done
- engine/manifest-verify.js: verify() + CLI (exit 0 trusted, 1 refused, 3 no key pinned).
- install/setup.sh update_manifest_ok, called after tar and before the tarball is removed or anything runs; uses the
  INSTALLED node and the INSTALLED verifier; installs without a verifier are not checked and say so.
- tools/lib/manifest-sign.js: check (key loads and is pinned) and sign (+ self-verify).
- tools/release.sh: 1c refuses a cut without a pinned key (test seam KOSMOS_MANIFEST_KEY_PROBE_BIN); 4b-era manifest
  publish signs it; .sig in _site_paths and in the rollback rm.
- tools/test-install.sh: the #4382 update-over-an-install block signs its manifest with the key when present, else a
  counted SKIP (a gate run refuses on skips).
- Tests: install.manifest-sig-6468.test.js (14), tools.release-gate.test.js new 1c arm (64/64).

## Verified
- Real arm: the served 0.7.56 tarball + manifest, signed with the real key: verifier accepts; one byte appended to
  app/server.js is refused.
- Mortals' copy of the key derives the pinned public key.

## Not run
- A real cut (release.sh end to end) and test-install.sh end to end: the next cut is the measurement.
- tools/dist-retention.sh does not prune .sig files (harmless, a few bytes each); not changed.

## Limits
- Until ask 3, setup.sh itself is fetched from the site, so a site that serves its own setup.sh skips this check.
- Losing both copies of the key means installs refuse updates until reinstalled fresh.
- A prod ROLLBACK to an older version is refused by installs that already updated (they stay put until a newer
  version is cut); a rollback must be cut as a new, higher version. --if-newer never downgraded anyway.
- No channel binding: a signed staging build newer than an install passes on a prod install.

## Review log
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

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

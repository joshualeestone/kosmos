# recoverykey-6609: the release recovery key, phase 1

Card: kosmos#6609 (security hardening item; detail kept with the security plan).

## Finished looks like (phase 1)
- engine/manifest-verify.js can decide which release keys to trust from a release key list signed by a recovery key, refusing a list that is unsigned, signed by another key, malformed, or older than the one this copy has already taken.
- tools/lib/release-keys-sign.js signs such a list with a recovery private key read from stdin only.
- Nothing changes for any install: RECOVERY_KEYS ships empty, and every update path still uses the built-in KEYS.

## Changes
- engine/manifest-verify.js: RECOVERY_KEYS (empty), KEY_LIST_STATE, ed25519Key (strict SubjectPublicKeyInfo), verifyKeyList, storedKeyListSeq, trustedKeys (off: built-in KEYS; on: the list's keys, seq stored when newer, mode 600, written atomically).
- tools/lib/release-keys-sign.js: the signing tool; checks its own output with verifyKeyList before reporting success.
- engine/manifest-verify.recovery-6609.test.js: 7 tests with throwaway keys, including a revoked key no longer opening a release (with a control where it still does).
- engine.reachable.test.js: trustedKeys excused until phase 2 wires it.

## Phase 2 (next)
Wire trustedKeys into runSetup, setup.sh's manifest checks and the .pkg helper; serve dist/release-keys.json(.sig) from the site; the release refuses to cut when the served list does not include its signing key. Activation: the recovery public key built in, and its first list (seq 1, the current release key) published before the release that turns it on.

## Rejected
- Letting a release change the trusted keys (pinned_keys in its manifest): that is the hole; a stolen release key could ship a release trusting another key.
- Storing the full list locally and trusting it when the site has none: a site that withholds the list would freeze a revocation. Phase 2 refuses when the list cannot be fetched.

## Weakest premise
That every copy checks for updates through a path that fetches the list (phase 2 must cover each). A copy that never updates never learns of a revocation, but it also installs nothing new.

## Evidence
- engine/manifest-verify.recovery-6609.test.js 7/7.
- install.manifest-sig-6468, install.setup-sig-6468, install.tmux-sig-6473 unchanged and passing.

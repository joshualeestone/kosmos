# recoverykey-6609: the release recovery key, phase 1

Card: kosmos#6609 (security hardening item; detail kept with the security plan).

## Finished looks like (phase 1)
- engine/manifest-verify.js can decide which release keys to trust from a release key list signed by a recovery key, refusing a list that is unsigned, signed by another key, malformed, or older than the one this copy has already taken.
- tools/lib/release-keys-sign.js signs such a list with a recovery private key read from stdin only.
- Nothing changes for any install: RECOVERY_KEYS ships empty, and every update path still uses the built-in KEYS.

## Changes
- engine/manifest-verify.js: RECOVERY_KEYS (empty), KEY_LIST_STATE, MIN_KEY_LIST_SEQ, ed25519Key (strict, canonical SubjectPublicKeyInfo only), verifyKeyList, storedKeyList (a damaged top record keeps its seq as the floor, and only a list at or above it repairs it), trustedKeys (off: built-in KEYS; on: the list's keys; a seq is never reused with other keys). The record is a folder with one seq-<n>.json per list taken, only ever added to (written aside, then linked into place), so concurrent checks and crashes cannot move it backwards, with no lock. A power loss can still lose the newest entry before the disk has it (fsync on macOS is not a full barrier), dropping the floor one list back; phase 2's freshness work narrows what a stale list can do in that window.
- tools/lib/release-keys-sign.js: the signing tool; checks its own output with verifyKeyList before reporting success.
- engine/manifest-verify.recovery-6609.test.js: 17 tests with throwaway keys, including a revoked key no longer opening a release (with a control where it still does).
- engine.reachable.test.js: trustedKeys excused until phase 2 wires it.

## Phase 2 (next)
- Every update path: fetch and check the list FIRST, then check the release with its keys; no list, no update.
- After a revocation: the next release raises MIN_KEY_LIST_SEQ to the revoking list's seq, so a fresh install refuses the list from before it.
- Freshness: lists carry no expiry yet. Whoever controls what a copy fetches can keep serving the last list from before a revocation to a copy that has not taken the newer one. Phase 2 adds an expiry (a signed not_after, re-signed on a schedule) or a recency check on issued.
- Callers never pass recoveryKeys, builtIn or minSeq from outside engine/manifest-verify.js.
- Activation: the test that pins RECOVERY_KEYS empty gets RECOVERY_KEYS.every(ed25519Key) (a typo in the built-in key would refuse every list).
- A damaged top record (possible after a power loss: fsync on macOS is not a full barrier) keeps its seq as the floor; the next list at or above that seq writes it afresh. Nothing is removed by hand, so the floor never drops.
- Signing: the recovery key comes off the clipboard; turn off clipboard history and Universal Clipboard first, or read it from a file on an encrypted volume.
- The record uses hard links; an install home on a filesystem without them (exFAT, some network mounts) would refuse every update once on. Not a concern on APFS homes; say so where activation is documented.
- Wire trustedKeys into runSetup, setup.sh's manifest checks and the .pkg helper; serve dist/release-keys.json(.sig) from the site; the release refuses to cut when the served list does not include its signing key. Activation: the recovery public key built in, and its first list (seq 1, the current release key) published before the release that turns it on.

## Rejected
- Letting a release change the trusted keys (pinned_keys in its manifest): that is the hole; a stolen release key could ship a release trusting another key.
- Storing the full list locally and trusting it when the site has none: a site that withholds the list would freeze a revocation. Phase 2 refuses when the list cannot be fetched.

## Limits of the record (phase 1)
- Files are added, never removed; a damaged top file is replaced in place by a verified list at the same seq, whose keys cannot be compared with the damaged one. That relies on the recovery key never signing two lists with one seq: the signing tool sees only the list in its output folder, so the signing runbook must keep every published list and sign from that folder.
- The record is not signed. Whoever can write the install home can delete it (the floor drops to MIN_KEY_LIST_SEQ) or plant a high seq file (this copy then refuses every later list until it is removed). Both need local write access; phase 2's refusal message should say what to do.
- A power loss can lose the newest entry before the disk has it (fsync on macOS is not a full barrier), dropping the floor one list back.

## Weakest premise
That every copy takes the newest list BEFORE it checks a release. A release signed with a stolen key carries its own copy of engine/manifest-verify.js, RECOVERY_KEYS included, so a copy that installs one before taking the revocation leaves the scheme. Phase 2 must therefore fetch and check the list first on every update path, and refuse the update when the list cannot be had. A copy that never updates never learns of a revocation, but it also installs nothing new. Second: until phase 2 adds an expiry, a fetch path that withholds the newer list (serving the older one) holds a copy that has not taken it on the revoked key.

## Evidence
- engine/manifest-verify.recovery-6609.test.js 17/17 (perturbed: removing the seq check turns the rollback test red).
- install.manifest-sig-6468, install.setup-sig-6468, install.tmux-sig-6473 unchanged and passing.

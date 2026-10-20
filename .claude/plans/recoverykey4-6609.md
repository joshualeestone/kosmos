# recoverykey4-6609: a release cut refuses a signing key the served release key list does not name (#6609 phase 2c, cut side)

Card: kosmos#6609 (detail private). Independent of phases 2a (#6687) and 2b (recoverykey3-6609): it reads only phase 1 (verifyKeyList, RECOVERY_KEYS), which is on main. Phase plan: `.claude/plans/recoverykey-6609.md`.

## Finished looks like (this slice)
With a recovery key pinned in the checkout, release.sh step 1c (before the bump and before anything is built) stops the cut unless the site's origin/main serves dist/release-keys.json and its .sig, the list verifies under the checkout's recovery keys, and it names this cut's signing key. Off as shipped (RECOVERY_KEYS empty): it says so and the cut goes on as before.

## Decided
- **The cut checks the list; it never writes it.** The list is signed offline with the recovery key and committed to the site by whoever holds that key (the phase 1 signing tool, tools/lib/release-keys-sign.js). A cut that could publish a list would let the release key decide the trusted keys, the hole phase 1 rejected.
- **Read from the site's origin/main**, the same view the served-release check (#6468 round 7) uses, so the cut is checked against what installs will actually fetch.
- **No list served, while on, is a refusal**, with its own sentence: the files may be named in a plan but absent.
- Not here, still phase 2: the .pkg helper taking the list (the hard gate beside RECOVERY_KEYS), freshness (an expiry), raising MIN_KEY_LIST_SEQ after a revocation, and activation (pinning the recovery public key and publishing list 1 before the release that turns it on).

## Weakest premise
That the checkout's RECOVERY_KEYS are the ones installs use. A cut is checked against the NEXT release's keys; installs check with the keys of the release they run. They match from activation on because RECOVERY_KEYS only changes by a release, and the list is the same file for both; a recovery key rotation (not designed yet) would need its own rule.

## Validation
- tools.check-list-6609.test.js (4): the tool from a scratch tree with throwaway keys; off, a list naming the key, a list not naming it, no list, a list from another signer; and release.sh's call (on origin/main, after check-served, before step 1d, exit 1 on refusal). Mutants measured red: the name check skipped (1), a missing list passing (1), the call removed (1), no exit on refusal (1).
- install.manifest-sig-6468, tools.every-test-runs, tools.release-gate pass (71 with the new file); tools/test-release-detached.sh 0 failures.

## Review log

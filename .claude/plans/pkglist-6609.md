# pkglist-6609: the .pkg's release check takes the release key list (#6609 phase 2, .pkg side)

Card: kosmos#6609 (detail private). Phase plan: `.claude/plans/recoverykey-6609.md`. Phases 2a (run-setup) and 2b
(setup.sh) and the cut side of 2c are on main; this is the ".pkg installer's pinned path" the RECOVERY_KEYS comment in
engine/manifest-verify.js listed as not done.

## Finished looks like
With a recovery key built into kosmos-pkg-verify, a first install from the .pkg trusts only the release keys a key
list signed by that recovery key names (checked as verifyKeyList checks it, and not below the list floor), fetched
from beside the manifest; a missing or bad list refuses as a bad signature does. As shipped (no recovery key) nothing
changes, and the site serving no list changes nothing.

## Change
- install/pkg-verify/main.swift: recoveryKeys (empty), minKeyListSeq, maxSeq, keyListType mirroring
  engine/manifest-verify.js; ed25519Key (canonical spelling only, as the JS one); keyListKeys (verifyKeyList's checks
  plus the floor); two optional arguments, the list and its signature. On, the manifest is checked under the list's
  keys only. The built-in release keys are now also read through ed25519Key (they are canonical; the #6576 parity
  test pins them to the JS KEYS).
- install/pkg-scripts/postinstall: fetches dist/release-keys.json and .sig beside the manifest, best effort, and passes
  both paths. A failed fetch leaves neither file; the helper decides.
- engine/manifest-verify.js: the RECOVERY_KEYS status comment moves the .pkg path to done.
- install.pkg-verify-keylist-6609.test.js: constant parity with the JS; the helper compiled on (throwaway recovery key,
  floor 3) and off; every list case run through the JS verifyKeyList and the helper, same verdict; the postinstall
  root step lifted verbatim against a file:// site with and without a list.

## Decided
- The helper keeps no record of lists (a first install has none to keep); the floor is minKeyListSeq, the same floor
  a fresh install's runSetup uses. The installed copy records the list on its first update.
- The postinstall never requires the list: it cannot know whether the helper is on, and requiring it while off would
  break every .pkg install until 2c serves one.
- Rejected: falling back to the built-in keys when on and the list is missing. A site that withholds the list would
  then reopen a revoked key, the hole phase 1 rejected.

## Weakest premise
That JSONSerialization reads a signed list the way JSON.parse does for every list the recovery key would sign. The
test compares verdicts on 25 lists, not every input; duplicate keys inside the JSON object and a byte-order mark are
not covered. The bytes are signed by the recovery key, so only a list Kosmos itself wrote reaches the parser.

## Validation
- install.pkg-verify-keylist-6609.test.js and install.pkg-verify-6576.test.js: 23/23 on macOS with swiftc.

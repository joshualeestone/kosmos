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
- install/pkg-verify/main.swift: (the list must be in the signing tool's exact form) recoveryKeys (empty), minKeyListSeq, maxSeq, keyListType mirroring
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
- The helper keeps no record of its own. Its floor is minKeyListSeq, raised to the highest list this Mac's existing
  Kosmos has taken: the postinstall runs for every install, existing or not, and reads that copy's record
  (release-keys.state at the default home) by file name, as storedKeyList does. Reading a user-owned record can only
  raise the floor. Left uncovered, stated in the helper's header: a Mac with no Kosmos at the default home (a first
  install, or one under another home) has only the built-in floor, so an old .pkg takes an old list there.
- Not changed: the list fetch reuses the root step's one cache-buster across retries, as the manifest fetch already
  does; and an OFF helper still has the list fetched (it cannot be asked first). Both cost time, never trust.
- The postinstall never requires the list: it cannot know whether the helper is on, and requiring it while off would
  break every .pkg install until 2c serves one.
- Rejected: falling back to the built-in keys when on and the list is missing. A site that withholds the list would
  then reopen a revoked key, the hole phase 1 rejected.

## Weakest premise
That the signing tool stays the only writer of lists. The helper takes a list only in the exact form
tools/lib/release-keys-sign.js writes (JSON.stringify, two-space indent, fixed field order, trailing newline), so it
never reads a list differently from the installed copies (a field named twice, a byte-order mark, another encoding
are all refused); a test signs a list with the real tool and the helper takes it. If the tool's output form changes,
that test goes red. The helper decodes signatures more strictly than the JS (no missing padding, no inner spaces):
that can only refuse, never accept.

## Validation
- install.pkg-verify-keylist-6609.test.js and install.pkg-verify-6576.test.js pass on macOS with swiftc.
- Mutants measured red: built-in keys kept beside the list, the floor removed, the form check removed.

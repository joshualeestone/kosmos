# Cut preflight also probes the Installer identity and the notary key (#3647)

## Problem
release.sh step 1c (`tools/lib/cut-sign-preflight.sh`) test-signed with the Developer ID Application
identity only. Step 3c productsigns the installer with the Installer identity and notarises it with
the `kosmos-notarize` .p8 whenever the pkg's inputs changed, which is always true on the first cut
after #3643 merges. A box holding only the Application cert passed 1c, ran the suite and the page
layer (about 15 minutes), then died at 3c.

## Call
After a good Application test-sign, `kosmos_sign_preflight_installer_and_notary` checks:
- `security find-identity -v` lists the Installer identity (KOSMOS_INSTALLER_CERT, or the lib
  default; a SHA-1 override matches too, since find-identity prints hashes)
- `secrets-map.sh path $KOSMOS_NOTARY_SECRET_TARGET` resolves to a readable file

Either missing refuses at 1c with the fix named. Test seams are functions (KOSMOS_SECURITY_BIN,
KOSMOS_SECRETS_MAP_BIN), like the existing codesign seam.

## Rejected
- Requiring these only when the pkg needs rebuilding. That IS computable at 1c
  (`pkg_publish_needed "$SITE/dist" "$(pkg_input_sha "$REPO")"`; $SITE is set before 1c), so this is a
  choice, not a limitation: always require all three. Cost, named: a box that cut fine without the
  Installer identity or notary key (because its pkg happened to be current) now refuses at 1c. Every
  cut runs on Mortals, which holds all three (probed for real 17:25), and the first cut after #3643
  needs them regardless. What would change my mind: a second cut box that legitimately lacks the
  Installer identity.
- Test-signing a pkg in 1c: find-identity proves presence, and the existing app test-sign already
  proves the keychain is unlocked in this session (both identities live in the same login keychain).

## Not covered, named
Two valid Installer identities matching the same name (an ambiguous match) pass 1c; productsign at
3c would then fail. build-installer-pkg.sh's own pre-check has the same limit. A real productsign
test at 1c would cover it and was rejected above as unnecessary for presence.

The match is a substring, like 3c's own `grep -qF` and like productsign, which also
accepts a partial identity name. So an override that is a fragment of a DIFFERENT
listed identity (a truncated SHA-1, say) passes 1c. Kept on purpose: an exact match at
1c would refuse fragments that 3c accepts, and the default is a full name.

## Weakest premise
That a present Installer identity is usable whenever the Application one just signed (same keychain,
same unlock). A separately locked or partitioned Installer key would still fail at 3c.

Built on signing-identity-3643 (it needs KOSMOS_SIGN_INSTALLER_DEFAULT and
KOSMOS_NOTARY_SECRET_TARGET); rebased onto main after #3652 merged (58443893).

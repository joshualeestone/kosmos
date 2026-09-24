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
- Requiring these only when the pkg needs rebuilding: that decision is made at 3c from the site dist,
  which 1c does not have yet. Every real cut box should hold all three; Mortals does (probed for real
  17:25, both pass).
- Test-signing a pkg in 1c: find-identity proves presence, and the existing app test-sign already
  proves the keychain is unlocked in this session (both identities live in the same login keychain).

## Weakest premise
That a present Installer identity is usable whenever the Application one just signed (same keychain,
same unlock). A separately locked or partitioned Installer key would still fail at 3c.

Branched from signing-identity-3643 (it needs KOSMOS_SIGN_INSTALLER_DEFAULT and
KOSMOS_NOTARY_SECRET_TARGET); rebase onto main once #3652 merges.

# kosmos#5896 slice 2: the build ships a sealed, signed Kosmos.app; setup.sh places it

Stacked on slice 1 (branch sealedapp-5896, PR #5904): every Mac install now writes the account's own install config,
and the app reads it.

## Finished looks like
- `tools/build-kosmos-bundle.sh` assembles `app/Kosmos.app` in the tarball: `Contents/MacOS/Kosmos` (the signed
  native binary), `Contents/Info.plist` (the same keys build_app_bundle writes today, with the BUILD's version), and
  `Contents/Resources/Kosmos.icns`. It signs the BUNDLE (runtime, timestamp, the app's entitlements), then checks
  `codesign --verify --deep --strict`, the identifier `com.chaoskosmos.kosmos`, and that the entitlement survived.
- `install/setup.sh` places that sealed bundle (a copy, nothing written into it afterwards) when, and only when,
  this install wrote the account's config (write_install_config returned 0) and the shipped bundle verifies.
  Otherwise it builds the per-install bundle exactly as today (build_app_bundle), so a sandbox, a custom-home
  self-host install, a failed write, or a tarball without the bundle behave as now.
- `bundle_is_ours` gains a third proof for the sealed shape: the icon's signature is valid and satisfies the
  designated requirement of THIS install's own shipped bundle (read with `codesign -d -r-`, so the team and the
  identifier come from the signature and setup.sh never spells the Team ID, which tools/test-cut-sign-preflight.sh
  forbids outside tools/lib/signing-identity.sh).
- Uninstall: a sealed icon in the SHARED folder (SYS_APP_DIR) is left in place and the transcript says so, because
  every account's Kosmos is now that same icon and another account may be using it. A sealed icon in the person's
  own ~/Applications is removed as today.

## Decisions (Angel, 2026-10-12 night shift; reversible)
- Sealed only when the account config was written. Rejected: always sealed (a custom-home self-host or a harness
  would get an icon that opens the default install, the slice-2 gate from iteration 2 of slice 1).
- Ours = satisfies our designated requirement. Rejected: an equal CDHash (an icon from the previous version would
  never be "ours", so it would never update); spelling the Team ID in setup.sh (forbidden by the cut preflight test).
- Leave the shared sealed icon on uninstall. Rejected: removing it (strands another account that still uses it).
  Cost: an uninstall from the only account leaves an icon behind; the transcript names it.
- The Info.plist version is the build's. Weakest premise (from the card): that the app never needs its plist version
  to match the installed board.

## Not in this slice
Notarize and staple (slice 3, after Renet's #5137).

## Tests
- tools/test-release-detached.sh: a verifying sealed app passes and its files are never sought in the tree; one
  changed after signing is caught by its signature; with "sealed" expected, a tarball without it fails; CONTROL with
  no expectation. Removing the comparator's skip fails the first case.
- install.sealed-app-5896.test.js (real setup.sh functions, real ad-hoc-signed bundles, no keychain): placement is
  sealed only with the config written (0); 2, 1 and no shipped app build as before; a shipped app that does not
  verify is not used; bundle_is_ours proves our own sealed icon and refuses another signature, a missing shipped copy
  and a changed icon; a bundle with a per-install file is still judged by it; the uninstall's sealed check sits
  before the removal branch. Making bundle_is_sealed always true, or dropping the config condition, fails a test.
- tools/test-codesign-retry-5149.sh: three codesign_ts_retry signs in the build (was two).
- tools/test-install.sh: reads the config from the shape the install used; checks the icon is the sealed one when
  the build shipped it.
- The build's sealed block was run by hand with an ad-hoc identity against a real compiled binary: assembled,
  signed, verified --deep --strict, identifier checked, executable ran.

## Not run (and where it runs)
- A real Developer ID build of the sealed app: needs the signing keychain; it runs at the next cut (build step 4).
- tools/test-install.sh: needs staged dist trees and launches the app; it runs at a cut on Mortals.

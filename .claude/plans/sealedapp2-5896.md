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
- A sealed bundle counts as ours only when THIS account owns it on disk (iteration 3). Another account's sealed icon
  is theirs: replacing it would leave an aside this account cannot delete and flip the shared icon between the two
  accounts' versions, so the icon diverts to ~/Applications as for any foreign occupant. In the shared folder it
  also needs this run to place the sealed app (iteration 2), or the per-install fallback would leave other accounts
  that use the icon opening this install. Residue sweeps take this account's own sealed leftovers.
  Follow-up worth a card: another account's sealed icon already serves this account (the app reads the clicking
  account's own config), so the divert could become "use it and say so" instead of a second icon.
- A sealed icon serves the install the account's config names (iteration 6): an account may also hold a second,
  custom-home install (write_install_config stands down for it), and that install never replaces, sweeps or
  uninstalls the sealed icon. Uninstall decides this before it deletes anything. Leaving an icon in the shared
  folder only needs "a Kosmos-signed bundle with no per-install file" (bundle_looks_sealed), since it never deletes.
- Follow-up worth a card: on a Mac with one account, uninstall now leaves the shared sealed icon behind and asks the
  person to drag it to the Trash. Removing it needs proof that no other install of this account relies on it, and
  tools/test-install.sh's own harness shows two installs can share one account config, which defeats the proof
  (iteration 7 kept the safe default; the card is where to settle it).
- A cut is Developer ID signed by construction (step 1c's preflight), so the cut's team requirement never meets an
  ad-hoc build; other callers of the comparator check the identifier only (iteration 4).
- Leave the shared sealed icon on uninstall. Rejected: removing it (strands another account that still uses it).
  Cost: an uninstall from the only account leaves an icon behind; the transcript names it.
- The Info.plist version is the build's. Weakest premise (from the card): that the app never needs its plist version
  to match the installed board.

## What a person will notice (reasoned, not measured; check at the first cut)
- macOS privacy permissions are keyed to the app's code identity. Today's icon runs the standalone binary, signed
  with the identifier `kosmos-app`; the sealed app is signed as `com.chaoskosmos.kosmos`. So after the first update
  that places the sealed app, expect Kosmos to ask ONCE more for the microphone, speech recognition and permission
  to control Terminal. Worth a line in that release's notes.
- On a Mac where this account's config could not be saved where the app looks, and its own sealed icon already
  sits in /Applications, the install says so and puts this install's icon in ~/Applications (iteration 5).

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
- A Developer ID upgrade: an icon from the previous version (another cdhash, the same team requirement) recognised
  and replaced. Every test bundle is ad-hoc, whose requirement is its exact cdhash; the first real cut and the first
  update after it are where this is seen. A local ad-hoc build (KOSMOS_CODESIGN_ID=-) never recognises an older
  icon and diverts the upgrade.
- Another account's sealed bundle (ownership): cannot be made without root; the rule is pinned by its text.

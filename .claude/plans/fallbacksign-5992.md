# fallbacksign-5992: seal the per-install Kosmos.app that build_app_bundle assembles

Card: #5992. From Josh's "Kosmos is damaged" on Agent1s and Mortals, 2026-10-12 (#5896).

## Finished looks like
The bundle build_app_bundle writes passes `codesign --verify --deep --strict`, has _CodeSignature, keeps the
program's hardened runtime flag and entitlements, and a test that runs the REAL function on a real bundle proves
it, with a control showing the same bundle without the signing step does not verify.

## Change
install/setup.sh build_app_bundle, last step: `codesign --force --sign - --preserve-metadata=entitlements,flags "$app"`,
then verify; either failing returns 1 (every step in this function carries its own return 1).
New test install.fallbacksign-5992.test.js (macOS only, like install.sealed-app-5896).

## Checked, unaffected
- macOS only: the icon step sits inside `if [ "$(uname -s)" != "Linux" ]`.
- The ad-hoc signature gives the bundle the identifier com.chaoskosmos.kosmos (its CFBundleIdentifier), the
  same as the sealed app. bundle_looks_sealed, bundle_is_ours and the sealed paths all key on
  Resources/kosmos-install.json first (only the per-install bundle has it), and bundle_is_sealed needs the shipped
  app's requirement, which an ad-hoc signature cannot meet. native-app/main.swift makes no signature checks.

## Rejected
- Signing with the Developer ID at install time: no identity on a person's Mac.
- Not building a per-install bundle at all: it is the fallback for custom homes and sandboxes, which the sealed
  app cannot serve yet.

## Weakest premise
That an ad-hoc signed bundle with no quarantine flag opens with no dialog on macOS 27. Standard behaviour; being
measured on Agent1s, whose 0.7.38 copy was repaired the same way at 15:05.
Reasoned, not measured: macOS may ask for the microphone again after each update, since an ad-hoc identity is
tied to the exact bytes (the old broken bundle never had a stable identity either).

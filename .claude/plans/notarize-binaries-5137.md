# notarize-binaries-5137

Card: joshualeestone/kosmos#5137 (the app the .pkg installs is signed but not notarized).

## Scope (this PR)
- tools/lib/notarize-binaries.sh: zip the signed kosmos-app and kosmos-tunnel, `notarytool submit --wait`,
  require status Accepted read from its own key, then require each binary's own cdhash in Apple's ticket log.
- tools/build-kosmos-bundle.sh step: notarise both after the last sign and self-test, before packing; assert
  the shas taken after signing still hold. KOSMOS_NOTARIZE=0 skips loudly for local test builds.
- cut-sign-preflight wording: the notary key is now needed on every cut (it was already checked on every cut).
- tools/test-notarize-binaries-5137.sh: stub arms + wiring/order.

## Out of scope (filed separately)
- The unsealed Kosmos.app setup.sh assembles: measured still refused when quarantined even around a notarized
  binary ("code has no resources"). Needs a prebuilt signed+stapled bundle; its own card.

## Proof
- Real run of the lib against Apple on the served 0.7.38 binaries: Accepted, cdhashes matched; spctl verdict
  flipped from "Unnotarized Developer ID" to the same verdict nodejs's notarized node gets, about 5 min later.

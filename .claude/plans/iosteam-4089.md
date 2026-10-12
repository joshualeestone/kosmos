# #4089: iOS signs under Stone Syndicate (864QZ69GF2) so TestFlight ships now

**Branch:** `iosteam-4089` · **Card:** kosmos#4089 (Splinter routed it 10-12 17:03; Liu Kang out of usage until 10-16).

## The call (Josh via Splinter, 2026-10-12)
Ship TestFlight now under the active Stone Syndicate LLC team, internal testers only, and transfer the app to Kosmos
Agent Manager, Inc. after Apple approves #3643. Rejected: waiting on #3643 (pending since September). An App Store
app transfer keeps the bundle id, builds and testers.

## Change
- `ios/Signing.xcconfig`: `DEVELOPMENT_TEAM = 864QZ69GF2`, with a comment saying it is interim and why.
- `docs/phone-push-go-live.md`: an "Interim" paragraph above Step 4's done list, and the two lines that said the
  team is empty / waits on the org now say Stone Syndicate for now / change it after the transfer.

## Measured (App Store Connect API, read-only, kosmos-notarize key 43F2HU5BT8)
No app record and no identifier for io.kosmos.app on this team (control: the same query lists Mission Control
Parents). The key cannot write (403 registering the identifier). So Josh does three one-time steps (on the card).

## Weakest premise
That push can be added later: an APNs key has to come from the team that signs. Under Stone Syndicate that is a
Stone Syndicate APNs key until the transfer, then a new key from the new team. Push is not live today in any case
(the coordinator has no APNs key).

## Checks
- archive.sh reads 864QZ69GF2 from the file (its own sed, run by hand).
- ios/tools/test-check-ipa-entitlements.sh: VERDICT PASS.
- iOS CI builds with CODE_SIGNING_ALLOWED=NO, so a team in the file changes nothing there.

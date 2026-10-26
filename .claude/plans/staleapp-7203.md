# staleapp-7203: a fresh account never reuses an older shared Kosmos.app

Card: kosmos#7203 (Josh, 2026-10-26 ~10:14, a new macOS user on the old Agent1s Mac, `curl .../setup-staging | sh`):
"This window is on an older version of Kosmos. It is running version 0.7.61, and Kosmos is on 0.7.63."

## What was measured (from the code)
- The alert's second number is the BOARD's own version (native-app/main.swift reads `version` from /api/status), not
  prod's pointer. The board was 0.7.63 because install/setup.sh reads latest.json (prod) unless
  KOSMOS_UPDATE_CHANNEL=staging is set on the `sh`, and Josh ran the bare command. So the alert told the truth about
  that board; "it compares against prod" is not a defect in the alert.
- The window was 0.7.61 because #5913 lets a second account reuse another account's sealed /Applications/Kosmos.app,
  and sealed_icon_reusable checked owner, placement and signature but never the version. The machine's earlier install
  had left a 0.7.61 app there.

## Decided
- sealed_icon_reusable also requires the shared app's CFBundleShortVersionString (app_bundle_version, plutil) to be at
  least this install's own shipped app's (version_at_least, dotted numbers). An older or unreadable one is left in
  place (it is another account's) and this account gets its own icon in ~/Applications through the existing divert,
  which setup then opens.

## Rejected
- Replacing the other account's app: not ours (#5913's rule).
- Naming the channel in the installer's closing lines for a bare setup-staging run: the same script runs every prod
  install and cannot tell a staging tester from a person installing Kosmos, so the line would be noise for most.
- A staging default for the bare `setup-staging` command: /setup-staging must stay byte-identical to install/setup.sh
  (the cut checks it, the promote copies it onto /setup), so a default would ride into prod's /setup. That needs the
  release to publish a wrapper, a change to the promote; not this card.

## Proven
- install.sharedicon-5913.test.js: a shared sealed icon of the same or a newer version is reused (controls); 0.7.61
  against 0.7.63, 0.7.9 against 0.7.10, and an unreadable version are not. Red without the version arm. A second test
  reads a real signed bundle's version through plutil. The existing fixtures now carry a version.
- install.sealed-app-5896.test.js and tools/test-installer-runnable-guard.sh pass.

## Weakest premise
That the old Mac's /Applications/Kosmos.app was another account's sealed app (the reuse path). If it was this account's
own stale icon, or an unsealed one, a different path decides; measuring that needs a second macOS user, which this Mac's
agent cannot create (no sudo).

## Not changed
- The .pkg install (it installs /Applications as root, a separate path).
- The alert's own wording; it was accurate for the board it described.

# iossign-6262: archive.sh signs by hand with an App Store profile (#6262 steps 4 to 6)

Kosmos Agent Manager, Inc.'s new Apple team has no registered device. Automatic signing archives with a development
profile first, which needs one, so `archive.sh --build 1` stopped with "Your team has no devices from which to generate
a provisioning profile". Step 4 of #6262 allows the API route: an Apple Distribution certificate and an App Store
profile, made through the App Store Connect API (done 2026-10-17: certificate V7D7FU295Q, profile "Kosmos App Store").

## What changes
- `KOSMOS_IOS_PROFILE=<profile name>`: the archive is signed by hand (CODE_SIGN_STYLE=Manual, "Apple Distribution",
  the profile), and the export options switch to manual signing with that profile for the bundle id.
- `ios/tools/export-options.sh` writes the export options and prints the archive's build settings, so both are tested
  without archiving.
- The profile name is refused (also by --check-config) when it would not reach the archive and the export unchanged:
  empty, a leading space, an apostrophe, a double quote, a backslash, a dollar sign, a control character.
- Without the variable, nothing changes.

## Decided
- **Hand signing, not a registered device:** a device needs Josh's phone identifier, which is a lookup to ask him for.
- **A deny-list of what breaks, not an allow-list** (review 2): Apple allows names like "Kosmos, Inc. App Store + Push".

## Weakest premise
That the Mac running it has the distribution certificate and key usable by codesign. On Agent1s that took one
person-only step (the keychain partition list, with the login password). Another Mac needs the same.

## Tests
ios/tools/test-archive-config.sh: name rules, the helper with and without a profile, the read-back, and archive.sh's
wiring through a recording stand-in xcodebuild. Build 1 was signed this way and is in TestFlight.

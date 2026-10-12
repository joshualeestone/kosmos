# kosmos#5896 slice 1: the app's install config lives in the account's own Library

## Finished looks like
The native app reads its install config (kosmosHome, ownerUid, port) from the running account's
`~/Library/Application Support/com.chaoskosmos.kosmos/kosmos-install.json` first, then the bundle's copy, then the
defaults. setup.sh writes that file on every macOS install (before the icon, whether or not this install writes the
icon), and --uninstall removes it only when it names this install. Nothing about the bundle changes in this slice, so
it ships alone; slices 2 (sealed bundle from the build, signature-based bundle_is_ours) and 3 (notarize and staple,
after Renet's #5137) follow. Design on the card, comment 6117861910.

## Why
A notarized, sealed Kosmos.app cannot be written to after signing, and build_app_bundle writes
Contents/Resources/kosmos-install.json into it per install. The app needs another place to learn which install it is
for, one the installer can write without touching the bundle.

## Decisions
- Order: KOSMOS_APP_CONFIG (tests) outright; else the account file, then the bundle copy. The first file that exists
  AND decodes wins, so a damaged account file falls back to the bundle copy rather than to nothing.
- The account file path uses the app's bundle identifier as its folder name.
- setup.sh writes under `${AGENT_WORKFORCE_HOME:-$HOME}`, like its other Library writes, so harnesses that sandbox
  AGENT_WORKFORCE_HOME keep it in the sandbox.
- 🛑 Sandbox guard: a non-default KOSMOS_HOME with the real home writes NOTHING (returns 2). The app reads this file
  first, so a harness that moved only KOSMOS_HOME would otherwise point the real app on this Mac at the sandbox. Same
  rule as uninstall's existing refusal for the real Application Support folder.
- Uninstall removes the file only when it carries this install's anchored `"kosmosHome":"<home>"` (an account can have
  another install).
- A failed write is a note, not a stop: the bundle copy still points the app at this install in this slice.

## Weakest premise
A self-host install with a custom KOSMOS_HOME and the real home is now treated as a sandbox for this file, so it keeps
relying on the bundle copy. Fine in slice 1; slice 2 must answer it before the bundle copy goes away.

## Tests
- native-app/main.swift --kosmos-app-mode-selftest: 6 new rows (order, override, another account, own file wins,
  damaged file falls back); expected 98 -> 104. Perturbing the order fails the two order rows.
- install.app-config-5896.test.js: lifts write_install_config and the uninstall block from setup.sh and runs them in
  bash under temp folders (sandboxed write, the sandbox guard, a real install control, uninstall keeps another
  install's file and removes its own).
- tools/test-install.sh: one chk that a real sandboxed install wrote the account copy.

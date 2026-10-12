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
- Order: KOSMOS_APP_CONFIG (tests) outright; else the account file, then the bundle copy. A bundle copy that decodes
  AND is this account's own (ownerUid == getuid()) wins, so an older account file naming another of this account's
  installs cannot redirect the app (challenge iteration 1). Otherwise the first file that exists AND decodes wins, so a
  damaged account file falls back to the bundle copy, and a bundle copy written for another account never outranks
  this account's own file.
- A sandboxed launch of the app must set KOSMOS_APP_CONFIG or KOSMOS_APP_TEST_HOME (main.swift header), since the app
  now reads the real account's Library first.
- The account file path uses the app's bundle identifier as its folder name.
- setup.sh writes under `${AGENT_WORKFORCE_HOME:-$HOME}`, like its other Library writes, so harnesses that sandbox
  AGENT_WORKFORCE_HOME keep it in the sandbox.
- 🛑 Sandbox guard: a non-default KOSMOS_HOME with the real home writes NOTHING (returns 2). "The real home" is decided
  with `-ef`, not a string compare, so the firmlink spelling, a resolved symlink and doubled slashes are all caught. The app reads this file
  first, so a harness that moved only KOSMOS_HOME would otherwise point the real app on this Mac at the sandbox. Same
  rule as uninstall's existing refusal for the real Application Support folder.
- Uninstall removes the file only when it carries this install's anchored `"kosmosHome":"<home>"` (an account can have
  another install).
- A failed write is a note, not a stop: the bundle copy still points the app at this install in this slice.

## Weakest premise
A self-host install with a custom KOSMOS_HOME and the real home is now treated as a sandbox for this file, so it keeps
relying on the bundle copy. Fine in slice 1; slice 2 must answer it before the bundle copy goes away.

## Gates slice 2 must clear before the bundle copy is dropped (challenge iteration 2)
- The custom-KOSMOS_HOME-with-real-home install above gets its config some other way (it writes no account file).
- The account file becomes the only source, so a stale one (its kosmosHome gone after a reinstall elsewhere) needs
  handling; today a same-account bundle copy outranks it.

Known, not changed here: #677 wording. Another account that opens the shared icon and has its own account file now
resolves through the config's ownerUid == getuid() path, so it gets the generic "Kosmos" wording rather than the
#664 fallback's "your Kosmos". Cosmetic, and slice 2 (the bundle copy goes away) is where that branch is reshaped.

## Tests
- native-app/main.swift --kosmos-app-mode-selftest: 8 new rows (order, override, another account, own file beats a
  foreign bundle copy, an own bundle copy beats the account file, no bundle copy, damaged file falls back); expected
  98 -> 106, pinned in native-app.computer-mode-4356 and native-app.download-5167. Perturbing the order fails the two
  order rows; removing the own-bundle preference fails its row.
- install.app-config-5896.test.js: lifts write_install_config and the uninstall block from setup.sh and runs them in
  bash under temp folders (sandboxed write, the sandbox guard, the real home spelled two other ways, a failed write,
  a real install control, uninstall keeps another install's file and removes its own). The spelling case fails
  against the old string compare.
- tools/test-install.sh: one chk that a real sandboxed install wrote the account copy.

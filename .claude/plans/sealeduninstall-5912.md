# kosmos#5912: uninstall removes the shared sealed icon on a one-install account

Stacked on #5896 slice 2 (sealedapp2-5896); opened as a PR only after that lands.

## Finished looks like
`--uninstall` removes /Applications/Kosmos.app when it is the sealed icon AND it is this install's (this account owns
it on disk and the account config named this install when the uninstall began, i.e. bundle_is_ours ... remove) AND
no other install of this account remains (no other board login job in the account's LaunchAgents folder:
com.kosmos.board or com.kosmos.board.<8 hex>, other than this install's own). Otherwise it is left in place and
named, exactly as slice 2 does. The closing sentence follows (it qualifies only when the icon was left).

## Decision and reasoning
On the card (#5912). Another account never opens an icon this account owns (slice 2 makes such an icon foreign to
them, so they get their own), so only this account's other installs can rely on it. Weakest premise: a board login
job is a reliable sign an install exists; if one is missing, the icon is removed under that install and its next
setup run puts it back. Interaction with #5913 noted on both cards.

## Tests
- install.sealed-app-5896.test.js: other_board_installs on a real folder (empty; a watchdog, its hashed form, a
  backup and an agent job are not installs; this install's own board is not another; default and custom-home boards
  see each other); shared_sealed_stays on a real sealed icon (removed on a one-install account; kept with another
  board, with no requirement captured, or when the config names another install, each with a control; a per-install
  icon is not handled as sealed); the uninstall asks it before the removal branch, with this install's label.
- The left-in-place note now says why: another install of this account, or an icon not proven this install's
  (iteration 1).
- tools/test-install.sh: the owner-uninstall checks in the probe, alias and deep worlds accept removal or the named
  left icon (which one depends on which other boards remain in the harness's shared LaunchAgents folder). These run
  only in a full yarn test:install, not at a cut.

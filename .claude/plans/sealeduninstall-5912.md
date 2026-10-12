# kosmos#5912: uninstall removes the shared sealed icon on a one-install account

Stacked on #5896 slice 2 (sealedapp2-5896); opened as a PR only after that lands.

## Finished looks like
`--uninstall` removes /Applications/Kosmos.app when it is the sealed icon AND it is this install's (this account owns
it on disk and the account config named this install when the uninstall began, i.e. bundle_is_ours ... remove) AND
nothing left on this account could open it afterwards (see the review round below: only a runnable DEFAULT install
can, and only when this install is not the default). Otherwise it is left in place and named. The closing sentence
follows (it qualifies only when the icon was left).

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


## Review round (2026-10-12 11:4x CDT, after the rebase): the rule changed
A fresh review found that keeping the icon "for another install of this account" kept a BROKEN icon: the sealed app
opens the install the account config names, or the default home when there is none, and this uninstall removes the
config when it names this install, so afterwards the icon can open only the DEFAULT install. New rule
(`sealed_opens_another`, replacing other_board_installs): keep it only when this install is not the default and the
default install is runnable (its bin/kosmos executable: the test native-app/main.swift makes before it opens a home;
a board login job was the first version and is a weak proxy, round 2). The note
for a kept icon now says it still opens this account's main Kosmos install. tools/test-install.sh's three owner-
uninstall checks assert ONE outcome (sealed_icon_must_go); in the probe world the sealed icon follows the config, so
the home3 uninstall (the install the config names) takes it and the owner finds it gone. #5913's contract is named
where it plugs in (shared_sealed_stays).
Weakest premise: tools/test-install.sh's changed checks have not been run anywhere (a cut runs only the gate half);
the unit tests exercise the rule on a real sealed icon.

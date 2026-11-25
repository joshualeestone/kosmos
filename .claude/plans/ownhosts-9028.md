# ownhosts-9028: only the person's own computers open inside the iPhone app (kosmos#9028, for #7352)

**Posture:** production (the submission build).

**Finished looks like:** a link to community.kosmosplus.com (or any address under the Kosmos+ domain that is not one of the
signed-in person's computers) opens in Safari. Signing in, notifications, switching computers, back and reload work as before.

## Why
`Shell.isOurs` accepted any one-label host under the Kosmos+ domain, so the public community opened in the app. The 1.0 age
rating says social media No and that nothing is public. Splinter (11-24 20:30): an allowlist, not a denylist.

## Change
- ShellLogic.swift: `linkDecision` takes `Known` (own hosts, reserved names, the page it comes from). Under https and the Kosmos+
  domain: the coordinator is in the app; a reserved name never is; then one of the person's own hosts, back or reload, or the
  page already showing; or Kosmos+'s own redirect (pageFlow from the coordinator's page over https). Everything else is Safari.
- `Shell.ownHosts`: the account's computers, the connected one, the remembered one, and the one the app itself is opening.
- ContentView.swift: the delegate builds `Known`; the app's own loads go through `Coordinator.open`, which records the host; a
  redirect is judged by the last address let in, since it has not committed. Sign-out replaces the recorded host.

## Why the redirect rule
Sign-in on the web page ends with Kosmos+ sending the page to the person's computer, before the account's list is read; a cloud
machine opens by a Kosmos+ handoff the same way. Without it, sign-in would end in Safari.

## Rejected
- The reserved list alone (a denylist): a name added later would slip through until both lists changed.
- The account's list alone: breaks sign-in and a notification on a cold launch, when it has not been read.

## Weakest premises
- A person's own board page could send itself to Kosmos+ and at once on to another computer's address, which would read as
  Kosmos+'s redirect. The board is the person's own code, and Kosmos+ still decides who that computer lets in.
- A computer added minutes ago, tapped in the board's switcher before the app reads the list again, opens in Safari once.
- Not run in a simulator yet: sign-in, a notification on a cold launch, the board's computer switcher, and the community link.

## Tests
ios/LogicTests/main.swift: every reserved name by every origin, a stranger's computer, the page showing, list read or not, the
sign-in redirect and its near misses, back, and ownHosts. 12 single removals, each failing the suite, control 2560 of 2560.

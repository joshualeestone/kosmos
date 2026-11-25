# ownhosts-9028: only the person's own computers open inside the iPhone app (kosmos#9028, for #7352)

**Posture:** production (the submission build).

**Finished looks like:** a link to community.kosmosplus.com (or any address under the Kosmos+ domain that is not one of the
signed-in person's computers) opens in Safari. Signing in, notifications, switching computers, back and reload work as before.

## Why
`Shell.isOurs` accepted any one-label host under the Kosmos+ domain, so the public community opened in the app. The 1.0 age
rating says social media No and that nothing is public. Splinter (11-24 20:30): an allowlist, not a denylist.

## Change
- ShellLogic.swift `linkDecision` takes `Known`. Under https and the Kosmos+ domain, in this order: the coordinator is in the app; a
  reserved name never is; one of the person's own computers, the page showing (a reload is that) or on its way, or back/forward
  to a host this web view has shown; or, only while the account's list is not read, an address a Kosmos+ page is sending it to
  (a sign-in, a cloud machine's opening). Everything else is Safari.
- `Shell.LinkTrail` (pure, tested): the page showing, the one on its way (cleared when it shows, fails or becomes a download), the
  one the app itself opened, and the hosts shown. Another account forgets the last two.
- ContentView.swift: the delegate feeds the trail; `BoardWeb.ownComputers` gives the account's list and the connected computer
  (held on BoardWeb, since a lock replaces the coordinator); the app's own loads of a computer go through `Coordinator.open`.

## Why the Kosmos+ rule
Sign-in on the web page ends with Kosmos+ sending the page to the person's computer before the list is read; a cloud machine opens by
a handoff the same way. WebKit reports a redirect with the kind of the navigation it answers, so the rule does not depend on the
kind. Once the list is read it no longer applies, so a service Kosmos+ adds later cannot come in by it.

## Rejected
- The reserved list alone (a denylist): a name added later would slip through until both lists changed.
- The account's list alone: breaks sign-in and a notification on a cold launch, when it has not been read.
- Treating a reload as let in: a reload of the page showing is already covered, and a redirected reload must not be.

## Weakest premises
- "The list is read" is "it has a computer in it": an account with none keeps the Kosmos+ rule, so for it a name Kosmos+ adds later
  could come in from a Kosmos+ page until the app's reserved list has it.
- A board page could send itself to Kosmos+ and at once on to another address while the list is unread. The board is the person's
  own code, and Kosmos+ decides who that computer lets in.
- A computer added since the list was read waits for one fresh list (BoardClient.rereadMacs) before it is judged; if that read fails, it
  opens in Safari.
- Not run in a simulator yet: sign-in, a notification on a cold launch, the switcher, back, and the community link.

## Tests
ios/LogicTests/main.swift: every reserved name by every kind with every other reason to let it in, a stranger's computer, the list
read or not, the Kosmos+ rule and its near misses, back, and the trail's steps. Single removals are listed on the PR.

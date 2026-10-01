# rolecase-4896 (slice 1): `kosmos project show` says one name for one role

Card: kosmos#4896 (split from #4891 item N11, the 0.7.15 diagnostic run by agents).

## Measured
- A member's role is `profileRole(card) || card.role` (engine/projects.js): either a label chosen off the menu
  ("Project Manager") or a line parsed out of the agent's own instructions ("project manager").
- The BOARD's member rows already normalise it: web `roleLine` looks the role up in the menu's titles
  (/api/roles), else raises only the first letter. So on the board both read "Project Manager".
- The CLI does not. `kosmos project show` (engine/projectview.js renderShow, used by the Mac and Windows CLIs)
  printed `m.role` raw, so an agent saw "project manager" beside "Project Manager". The diagnostic was run by
  agents through the CLI, which is where the report's two spellings came from (reasoned: the board could not have
  shown them).
- One more raw site on the board: the task assignee picker's `<option>` ("Name · role", web/index.html). Slice 2.

## The change
- engine/roles.js `roleTitle(role)`: the board's roleLine rule (a lookup on the `menu !== false` titles, any
  case; else the first letter only), exported.
- engine/projectview.js renderShow: the member line uses it. The payload (JSON) keeps the raw role.
- Tests: engine/projectview.test.js (two spellings of one title render as one; a non-title keeps its words; an
  acronym title comes from the menu) and roleTitle's rule.

## Decided
- Render-time, not at the source (engine/projects.js member.role): chat.defaultAgentFor and the room read the
  raw role, and the page normalises on its own; changing the payload would change every reader to fix one text view.
- Rejected: title-casing (would print "Seo Specialist").
- Same known quirk as the board, kept for parity: "iOS engineer" reads "IOS engineer".

## Not in this slice
- The picker `<option>` (needs a browser check; slice 2).
- "Every member shows the joining role whatever they joined to do": there is no per-project role or purpose on a
  membership today (a member's role is the agent's own), so this is a feature, not a rendering bug. It needs the
  report reproduced on a board first, to know what "joined to do" was meant to show (the agent's create `purpose`,
  or a per-project role that does not exist yet). Recorded on the card; the card stays open.

## Weakest premise
That the report's two spellings came from the CLI view. If they were seen on the board, the source is elsewhere
(the board's own roleLine already folds them) and slice 2 or a third surface is where to look.

## Reviews

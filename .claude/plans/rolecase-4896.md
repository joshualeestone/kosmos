# rolecase-4896 (slice 1): `kosmos project show` says one name for one role

Card: kosmos#4896 (split from #4891 item N11, the 0.7.15 diagnostic run by agents).

## Measured
- A member's role is `profileRole(card) || card.role` (engine/projects.js): either a label chosen off the menu
  ("Project Manager") or a line parsed out of the agent's own instructions ("project manager").
- The BOARD's member rows already normalise it: web `roleLine` looks the role up in the menu's titles
  (/api/roles), else raises only the first letter. So on the board both read "Project Manager".
- The CLI does not. `kosmos project show` (engine/projectview.js renderShow, used by the Mac and Windows CLIs)
  printed `m.role` raw, so an agent saw "project manager" beside "Project Manager". The diagnostic was run by
  agents through the CLI, so that is the likeliest source.
- The board has ONE raw site too (review 1, measured): the New task assignee picker builds `esc(m.role)`
  (web/index.html), so a person on that project sees "Ann · project manager" beside "Bo · Project Manager".
  That is slice 2, and it is a second possible source of the report.

## The change
- engine/roles.js `roleTitle(role)`: the board's roleLine rule (a lookup on the `menu !== false` titles, any
  case; else the first letter only), exported.
- engine/projectview.js overviewOf (which runs in the board) adds `roleTitle` beside the raw `role`; renderShow
  prints `roleTitle`, falling back to `role` from an older board. Review 1: the first version required roles.js in
  the CLI's own process, which reads the store there and can print a catalogue line on stderr; computing it in
  the board also uses the same downloaded catalogue the page learns its titles from.
- Tests: engine/projectview.test.js (two spellings of one title render as one; a non-title keeps its words; an
  acronym title comes from the menu) and roleTitle's rule.

## Decided
- An added field, not a changed one: `role` stays as stored (chat.defaultAgentFor and the room read it raw, and
  the page normalises on its own), and `roleTitle` is new.
- Rejected: title-casing (would print "Seo Specialist").
- Same known quirk as the board, kept for parity: "iOS engineer" reads "IOS engineer".

## Not in this slice
- The picker `<option>` (needs a browser check; slice 2).
- "Every member shows the joining role whatever they joined to do": there is no per-project role or purpose on a
  membership today (a member's role is the agent's own), so this is a feature, not a rendering bug. It needs the
  report reproduced on a board first, to know what "joined to do" was meant to show (the agent's create `purpose`,
  or a per-project role that does not exist yet). Recorded on the card; the card stays open.

## Weakest premise
That the CLI view and the assignee picker are the only two places the two spellings can be seen. Searched (review 1
measured): renderList, both CLIs, the room and chat code print no member role; the board's member rows fold it.

## Reviews

### Review 1 (blind): 0 BLOCKER, 1 WARNING, 3 NITs, all taken
- WARNING: the plan said the board could not have shown the two spellings; the assignee picker does. Corrected
  above; slice 2 covers it.
- NIT: the CLI loaded roles.js (store read, possible stderr line on Windows). Now the board works it out.
- NIT: no test proved the `menu !== false` filter; `kosmos guide` (setup, menu: false) now does.
- NIT (stated, not built): no test covers a title only the downloaded catalogue has (node --test loads none).

### Slice 2 (same branch): the New task picker uses roleLine; render-tasks.js asserts it (a route sets the member's
stored role lower case on GET /api/projects; the option must read "taskmate · Project Manager").

### Review 2 (blind): 0 BLOCKER, 1 WARNING (taken), 2 NITs (stated)
- WARNING: the precondition's comment claimed more than it checked. It now also reads the page's own PROJECTS and
  requires the member's role there to be "project manager", so a pass is the picker's doing.
- NIT (stated): an open picker is not rebuilt if the titles arrive after it opens; it reads "Project manager"
  until reopened (the board's documented fail-open). The check waits for networkidle, so a miss is a false red.
- NIT (stated): a whitespace-only role prints as stored, as on main.

### Review 3 (blind): CONVERGED (0 BLOCKER, 0 WARNING), 2 NITs not taken
- NIT: the "option carries a role" precondition matches any " · "; the final "· Project Manager$" check still holds.
- NIT: `require('./roles')` sits inside the member map (cached, cheap).
- Also measured by the reviewer: server.project-overview-4581.test.js 9/9 with the added field.

### Full suite (convergence run, 17:57 CDT): 13578 passed, 1 failed, fixed
- The one failure was fixture-discipline.test.js "no test builds an agent card or a roster row by hand": my new
  projectview test built member rows with `sessionName` literals. Rewritten to use the fixture's three described
  members, changing only their roles; the acronym case moved into the roleTitle unit test. fixture-discipline and
  projectview: 41/41. The PR's CI runs the whole suite again before the merge.
- Browser check render-tasks.js (the picker): PASS on 5f8c58892 (its #4896 asserts sit on the straight-line path,
  so a pass means each held).

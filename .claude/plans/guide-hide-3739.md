# guide-hide-3739: the setup guide is "Kosmos Guide", hidden, never "Unknown"

Card: kosmos#3739. Josh, 2026-09-25 08:51 (0.6.94 test): title "Kosmos Guide", drop the long one; should it be
hidden like a normal agent is not; it "renders with no context ring, and a model that says Unknown". Splinter's
call to hide it; Josh ruled at 09:22: "I agree.. let's hide it" (grid, list, org chart, counts; bubble only).

## What
- **Server** (`/api/status`): `markGuide` states `isGuide` on every row. The setup guide (`setupGuideNow()`) gets
  role `roles.GUIDE_TITLE` ("Kosmos Guide"). A Claude guide with no model known gets `plannedModelName`
  "Claude (its default model)" (Claude only: the OpenAI picker reads that field as a model id, and the page already
  names other runners). The counts (`countAgents`, the offline total, `notRunning`, needs-you) leave it out, so the
  tiles count what the grid draws. An unreadable removed list ('unchecked') still marks the seeded guide.
- **Role text** (`engine/roles.js`): `GUIDE_TITLE`; the setup label is the title; the first line is
  "You are **{{NAME}}**, the Kosmos Guide. You are an AI version of Josh, ..." so a new guide's card parses the
  same title (the identity parser reads the text after "the" up to the full stop).
- **Page** (`web/index.html`): every place the page LISTS or COUNTS agents filters out the guide inline
  (`!(a && a.isGuide === true)`): the grid, the list, the org chart, the tiles, the first-board flag, the connection
  banner, the reports-to pickers, the project add pickers, the DM tally, and the tour's new-board test. `LAST` stays
  complete for every lookup by name, so the guide's own page, its DM and the bubble still find it.

## Decided, and why
- **Mark on the server, filter on the page at the listing sites.** Dropping the guide from the payload would break
  every lookup by name (its page, its DM, the bubble). A listing site I missed only leaves the guide visible
  somewhere; a lookup I broke would break its page. So filtering happens where things are listed.
- **The title for an existing guide comes from the server, not a file rewrite.** Josh's guide was born with the
  old first line; the server gives the guide row the title whatever its file says.
- **"its default model", not a made-up model name.** A guide started with no `--model` runs on its runner's own
  default, which Kosmos does not know. Naming one would be a guess, so it names the runner and says "default".

- **The isGuide filter is written inline at each listing site, not as one helper.** A shared helper (and a stored
  LISTED array) broke three web tests that evaluate page snippets without page globals, so they could not see it
  (measured). The rule is one expression, `!(a && a.isGuide === true)`, repeated; the browser check reads what is
  drawn (grid, list, tile, banner) rather than trusting the expression.

## Accepted, and on the card
- The guide's own attention state (needs you, the trust prompt, a lost connection) is shown nowhere now: the
  bubble does not read the row's state. Follow-up for the bubble.
- A reports-to that names the guide shows "You" in the menu and draws at the hub. Unlikely: the guide's own create
  path sets no reports-to.

## Weakest premises
- Listing sites were found by searching for `LAST`/`data.agents` uses; a listing built another way would still
  show the guide. The browser check covers the grid, the tile, the banner and the guide's page, not every picker.
- The card's ring half is NOT done: the guide's own page draws its avatar without a ring before a reading. A
  first attempt changed the grid card's ring, which the guide no longer has (review round 1), so it was removed.
  Starting the guide's session sooner is not done either. Both are named on the card as a follow-up.
- #3734 also edits the setup role in `engine/roles.js`; whichever lands second rebases.

## Verification
- `server.guide-hidden-3739.test.js`: the rows are marked, the guide is titled, it has a model line, and the
  counts leave it out; with no guide nothing is marked. Mutations (counts include the guide; no title) RED.
- `engine/roles.test.js`, `engine.setup-assistant-3034.test.js`: the label is the title, the parser reads it, the
  long title is gone.
- `docs/browser-checks/render-guide-hidden-3739.js` (wired in tools/browser-checks.sh and the README): RED when
  the grid is drawn from `LAST`.

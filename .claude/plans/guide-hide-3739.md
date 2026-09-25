# guide-hide-3739: the setup guide is "Kosmos Guide", hidden, never "Unknown"

Card: kosmos#3739. Josh, 2026-09-25 08:51 (0.6.94 test): title "Kosmos Guide", drop the long one; should it be
hidden like a normal agent is not; it "renders with no context ring, and a model that says Unknown". Splinter's
call to hide it; Josh ruled at 09:22: "I agree.. let's hide it" (grid, list, org chart, counts; bubble only).

## What
- **Server** (`/api/status`): `markGuide` states `isGuide` on every row. The setup guide (`setupGuideNow()`) gets
  role `roles.GUIDE_TITLE` ("Kosmos Guide"). When no model is known, it gets `plannedModelName`
  "<Claude|OpenAI|Gemini|Grok> (its default model)". The counts (`countAgents`, `notRunning`) leave it out, so the
  tiles count what the grid draws.
- **Role text** (`engine/roles.js`): `GUIDE_TITLE`; the setup label is the title; the first line is
  "You are **{{NAME}}**, the Kosmos Guide. You are an AI version of Josh, ..." so a new guide's card parses the
  same title (the identity parser reads the text after "the" up to the full stop).
- **Page** (`web/index.html`): `LISTED` (= `LAST` without the guide) is used wherever the page LISTS or COUNTS
  agents: the grid, the list, the org chart, the tiles, the first-board flag, the connection banner, the
  reports-to pickers, the project add pickers, and the tour's new-board test. `LAST` stays complete for every
  lookup by name, so the guide's own page, its DM and the bubble still find it. Its ring before a reading is the
  plain empty track, not the dashed unknown ring.

## Decided, and why
- **Mark on the server, filter on the page at the listing sites.** Dropping the guide from the payload would break
  every lookup by name (its page, its DM, the bubble). A listing site I missed only leaves the guide visible
  somewhere; a lookup I broke would break its page. So filtering happens where things are listed.
- **The title for an existing guide comes from the server, not a file rewrite.** Josh's guide was born with the
  old first line; the server gives the guide row the title whatever its file says.
- **"its default model", not a made-up model name.** A guide started with no `--model` runs on its runner's own
  default, which Kosmos does not know. Naming one would be a guess, so it names the runner and says "default".

## Weakest premises
- Listing sites were found by searching for `LAST`/`data.agents` uses; a listing built another way would still
  show the guide. The browser check covers the grid, the tile, the banner and the guide's page, not every picker.
- The card also asks to start the guide's session sooner; not done. The ring and model now read honestly before
  it runs instead.
- #3734 also edits the setup role in `engine/roles.js`; whichever lands second rebases.

## Verification
- `server.guide-hidden-3739.test.js`: the rows are marked, the guide is titled, it has a model line, and the
  counts leave it out; with no guide nothing is marked. Mutations (counts include the guide; no title) RED.
- `engine/roles.test.js`, `engine.setup-assistant-3034.test.js`: the label is the title, the parser reads it, the
  long title is gone.
- `docs/browser-checks/render-guide-hidden-3739.js` (wired in tools/browser-checks.sh and the README): RED when
  the grid is drawn from `LAST`.

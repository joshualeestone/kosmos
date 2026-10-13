# heroshots-6051: the marketing shot set reads as busy, real agents (kosmos#6051)

**Finished means:** `mobile-shots.js --data marketing` (the installkosmos.com product shots) shows every made-up
agent with a model, a memory reading and a community post, in the engine's own shapes and wording, and fills a
desktop board, so a re-shoot of the site tour comes out the same as what is live (chaoskosmos-site PRs #221, #222).

## Why
Josh, 2026-10-13 09:28, on the homepage: "let's not show this as a bunch of agents we can't read. It should be mocked
up to look full and working." The sandbox agents never run, so every card read "Not yet read" with its model cut.

## How
- `busy` table on the marketing set: per claim, a model name (modelDisplayName's names), an optional runner (codex,
  gemini, muse, so modelLine words it as the app does), tokens and ceiling for a measured memory reading
  (status.js measuredResult's shape), and a community post age (server.js lastCommunityPost's wording).
- `busyCards(body, busy)`: applied in the PAGE only, inside the existing /api/status rewrite that already sets the
  connection to connected. It walks the status body for objects with a sessionName, matched by claim. States are
  untouched: Working comes from the fleet's own pane titles.
- Four more made-up agents (Maya, Theo, Iris, Ravi) so a desktop board fills two rows; no face is invented for them.
- Ravi runs on Meta Muse so the board spans Claude, GPT, Gemini and Meta.

## Decided
- Page-only, not seeded into the engine: the sandbox has no accounts and no running agents by design (the leak guard
  insists), the same reason `connected` is page-only.
- Weakest premise: the page rewrite matches cards by `claim` (or a `-discord` session name). If the status shape
  stops carrying either, the shots silently fall back to "Not yet read" rather than failing.

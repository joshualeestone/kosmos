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
- Each runner's reading is the engine's own: Claude from limitFor (assumed 1M for the 5.5 models), Gemini assumed,
  Codex its reported window, and Muse NO reading (Kosmos does not read Muse's memory yet), so the public shots never
  show a feature the product does not have. Known residual: the Muse card's state comes from the seeded pane
  (Idle), where a real Muse card's state comes from Muse's own reports; the shot does not claim anything Muse cannot do.
- Weakest premise: the page rewrite matches cards by `claim` (or a `-discord` session name). If that stops matching,
  the run now FAILS (exit 2) naming the agents, rather than shooting unread cards. It counts across the run, so a
  screen with its own /api/status route still shoots its own cards; the marketing tour's screens have none.

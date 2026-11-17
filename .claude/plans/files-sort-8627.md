# files-sort-8627: sort the agent and project Files screens

Card: kosmos#8627 (Josh, 2026-11-17 08:53). Owner: Renet Tilley.

## Ask
A sort control on the agent Files screen (View All) and the project Files screen, exactly four choices:
Newest first, Oldest first, A to Z, Z to A. Default Newest first (Splinter's call on the card, Josh can
override). Remember the choice per screen in the browser. The agent card's short Files list follows the same
default (newest first).

## Done when
On a real board both screens sort all four ways, a file saved a minute ago is on top by default, and A to Z
matches the old order. Check the iPhone app's Files list; file a follow-up card if it needs the same.

## Build (all in web/index.html; no server change)
- `FILES_SORTS`, `filesSortMode`, `filesSortRead`, `filesSortSave`, `filesSorted` beside `agentFileRow`. Pure
  sort by `modified` (the date each row shows), undated rows last in both date orders, ties A to Z; A to Z uses
  the same `localeCompare(numeric, base)` as engine/projects.js `byName`, so it equals the old agent screen order.
- `AGENT_FILES_SORT` / `DOCS_SORT` hold the choice in memory (so a refused localStorage still sorts as chosen),
  keys `kosmos.sort.files.agent` and `kosmos.sort.files.project`.
- Agent screen: `<select id="d-files-sort">` in `.dfiles-acts`; `paintAgentFilesAll` sorts dirs and files
  (folders stay first); a change clears the stamp and repaints.
- Project screen: `<div id="docs-sortrow">` with `<select id="docs-sort">` above the count, shown once the folder
  has a file, hidden with the folder's other parts on the conversation segment; `openDocsView` sorts the list; a
  change re-sorts in place and returns to page 1.
- 44px touch target on coarse pointers for both selects (own CSS line).
- The short list already comes newest first from `listFiles` (sort by modified); unchanged, now pinned.

## Decided
- Folders stay above files on the agent screen, each group in the chosen order (today's shape; a folder mixed
  among files would be a new layout nobody asked for).
- Client-side sort, no new route parameter: the agent browse answer is capped at BROWSE_MAX_ENTRIES and the
  project route at 500, both already say when they are partial.
- Weakest premise: the project route sends the newest 500, so on a folder over 500 files "Oldest first" is the
  oldest of those 500. The screen already says the rest are in the folder itself.

## Tests
- web.files-sort-8627.test.js: lifted functions, the four orders, default and fallback, undated and tie
  handling, an agreement test against listDir's real order, and the markup/keys.
- web.agent-files-3614.test.js / web.filebrowser-6724.test.js harnesses lift the new functions (pinned A to Z).
- docs/browser-checks/render-files-sort-8627.js: real board, chromium and webkit, both screens, all four orders,
  controls (server order), reload persistence per screen, refused storage, 412px touch geometry.

## Status
- [x] Built, unit tests and browser check green (54 PASS; 11 FAIL with the default mutated to A to Z).
- [x] Surface gate GATE_RC=0 (trailer for render-room-msgbox-2806.js, which passes).
- [ ] challenge-loop
- [ ] PR, CI, merge, design shots, iPhone follow-up check

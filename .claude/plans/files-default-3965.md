# files-default-3965: agents save documents as FILES, not artifacts; scratch files hidden (Josh 2026-09-26)

## Decisions
- The rule goes at the TOP of the per-agent "Where to save files" block (engine/dmfiles.js): a thing
  made for the person is a file, saved where the block says and named in the reply; no Claude
  artifact, shared doc or link unless asked for by name; and it outranks a tool's own publish
  default. Why there: that block is written for EVERY provider and re-synced into EVERY existing
  agent by dmfiles.syncEveryone (on board start and on its periodic pass, server.js), so it covers
  item 2 (existing agents) without a new mechanism. Not in engine/roles.js: role text is per role,
  and the card asks for the shared part.
- Why "outranks a tool default" is spelled out: a Claude agent's own harness tells it to publish a
  finished piece as an artifact by default; a softer sentence loses to an always-present one.
- Swarm helpers are the lead's subagents with no instructions file, so the lead's block
  (engine/swarm.js) now tells it to pass the rule on.
- Scratch files: projects.listFiles is the one walk behind the agent page's Files, project Files
  and View All. Dot-names were already hidden (.DS_Store, .~lock.*#); isScratchName adds `~$*`
  (Office owner files, Josh's "~$on (Grok A..." 162 B row), Thumbs.db and desktop.ini.

## Rejected
- Hiding by extension or size (a real 162-byte file would vanish).
- A client-side filter in web/index.html (three lists, three copies; the server walk is one).

## Weakest premises
- That a written instruction beats the harness's publish default in practice. It is the strongest
  lever Kosmos has without changing the provider's tools; a live run with a fresh agent is the
  measurement, and it needs the next cut.
- Existing SWARM leads get the new helper line only when their swarm block is next rewritten
  (a helper-count change); their own dmfiles block (the main rule) does sync.

## Verification
- engine/dmfiles.artifact-3965.test.js (5): the rule's wording and position, the swarm line, and the
  scratch filter (hides ~$, Thumbs.db, desktop.ini in any case, keeps ~notes.txt, price$.xlsx,
  thumbs.db.txt). Removing the `~$` clause reds the listing test.
- engine/dmfiles.test.js, engine/projects.test.js, engine/swarm.test.js green.

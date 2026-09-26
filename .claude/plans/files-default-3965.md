# files-default-3965: agents save documents as FILES, not artifacts; scratch files hidden (Josh 2026-09-26)

## Decisions
- The rule goes at the TOP of the per-agent "Where to save files" block (engine/dmfiles.js): a thing
  made for the person is a file, saved where the block says and named in the reply; no Claude
  artifact, shared doc or link unless asked for by name; and it outranks a tool's own publish
  default. Why there: that block is written for EVERY provider and re-synced into EVERY existing
  agent by dmfiles.syncEveryone (at board start, and on the person's name-form save; server.js), so
  it covers item 2 (existing agents) without a new mechanism. It rewrites the instructions FILE, not
  the running agent: an agent already running reads it at its next start. Not in engine/roles.js: role text is per role,
  and the card asks for the shared part.
- Why "outranks a tool default" is spelled out: a Claude agent's own harness tells it to publish a
  finished piece as an artifact by default; a softer sentence loses to an always-present one.
- Swarm helpers: CORRECTED after review. I first wrote that helpers have no instructions file and
  the rule only reaches them through the lead. Not measured, and likely false: a Claude Code
  subagent started in the lead's folder reads that folder's CLAUDE.md (the reviewer saw exactly
  that). So the swarm bullet is a REINFORCEMENT, and it now says the helper hands its file BACK and
  the lead saves it, so helpers keep working in their own copies and the lead still merges.
- Scratch files: projects.listFiles is the one walk behind the agent page's Files, project Files
  and View All. Dot-names were already hidden (.DS_Store, .~lock.*#); isScratchName adds `~$*`
  (Office owner files, Josh's "~$on (Grok A..." 162 B row), Word's ~WRL/~WRD####.tmp save files, the
  macOS `Icon\r` folder-icon file, Thumbs.db and desktop.ini (any case).

## Rejected
- (Residual of the prefix rule, accepted:) a person's own file whose name begins `~$` (say
  `~$5000 budget.xlsx`) is hidden too, with no sign. Office owns that prefix; the collision is
  judged unlikely enough to accept.
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

## Challenge-loop iteration 1
- DEFERRED: existing swarm leads get the helper bullet only when their swarm block is next written
  (tellLead has one caller, a maxHelpers PATCH; there is no boot resync). Not worth a new boot
  sweep for a reinforcement: the main rule reaches existing leads through the dmfiles boot sync and,
  per the correction above, very likely their helpers too.
- The test's new control (every hidden name is on disk) caught a fixture bug of mine:
  `desktop.ini` and `DESKTOP.INI` are ONE file on this Mac's case-insensitive disk, so the earlier
  fixture never wrote the second. It now writes one spelling.
- Kept "Two things come first" in the next paragraph: an existing dmfiles test pins that sentence.

## Challenge-loop iteration 2
- Folder skipping now has a test (scratch-named folders not walked, an ordinary folder walked as
  the control). The patterns are named constants, as the repo's convention asks.

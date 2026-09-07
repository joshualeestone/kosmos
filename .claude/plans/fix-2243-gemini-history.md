# fix-2243-gemini-history

Card: joshualeestone/kosmos#2243 (Agent auto-import: verify fresh-install import works, and
scan for Gemini agent files too). This branch is **Part 3** of that card.

## Card state (verified on origin/main before building)
- **Part 1** (verify fresh-install auto-import on a clean 0.6.35): genuinely needs-operator -
  it rides Josh's fresh-install test; I cannot spin a clean box. Not built here.
- **Part 2** (Gemini file-shape discovery): already shipped (PR #2332, `foundGemini` reads
  `~/.gemini/projects.json` + each `GEMINI.md`).
- **Part 3** (this branch): the weakest premise Part 2 named. `geminisession.projects()` read
  ONLY `projects.json`, so a Gemini agent that ran but whose project never landed in
  projects.json (or whose projects.json was cleared) was invisible to `foundGemini`. Verified
  still a real gap on origin/main: geminisession exposes only `projects()` from projects.json,
  and nothing in engine/ reads `history/*/.project_root`.

## Problem
Gemini also records a project's absolute cwd at `<home>/history/<name>/.project_root` (a
plain-text file, byte-identical to that project's projects.json key when both exist - measured
on this machine). A history-only project (no projects.json entry) never reached foundGemini.

## Fix
Extend `engine/geminisession.js` `projects()` to union TWO sources, de-duped, projects.json
first: (1) projects.json (Part 2's source, unchanged rules - absolute keys only, order
preserved); (2) `history/<name>/.project_root`, per-entry and tolerant (a missing history dir,
a non-directory entry, an unreadable subdir, or an absent/blank/relative `.project_root` is
skipped, never thrown). `foundGemini` iterates `geminisession.projects()`, so it now discovers
history-only Gemini agents with ZERO change to discover.js (no new caller, no browser surface).

## Decisions
- **Extended `projects()` rather than adding a new function.** foundGemini's semantics ("the
  project cwds Gemini has recorded") still hold - history is a place Gemini records cwds - so
  the single call site gets both sources with no discover.js change. Keeps the ~/.gemini
  resolution in geminisession (the #1432/#1500 separation) and honors AGENT_WORKFORCE_GEMINI_HOME.
- **No web/ change**, so no #1720 browser-check concern; this is an engine-only discovery read.
- **Priority: low, and stated as such.** Gemini is not yet a selectable provider ("coming
  soon"); Josh explicitly asked only that discovery AWARENESS of Gemini shapes be complete, not
  that Gemini support be built. This completes that awareness (a Gemini agent invisible to
  discovery was an incomplete awareness). Splinter endorsed it as a legitimate default absent a
  higher-value flow slice.

## Tests (engine/discover.gemini.test.js, perturbation-proven)
Added a `historyRoot` helper + 3 assertions (8 total in-file, all green):
- a Gemini agent recorded ONLY in history/.project_root (absent from projects.json) is found.
- a cwd in BOTH sources is offered ONCE (de-dupe guard, against the union double-counting).
- a missing/blank/relative .project_root is skipped, never throws, raises no unreadable.
Perturbation: reverting geminisession.js to projects.json-only reds exactly the history-only
test; restored 8/8.

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
first: (1) projects.json (Part 2's source; order preserved - but its keys now also flow
through the shared `add()` so they are trimmed + trailing-slash-stripped, a benign change from
part 2's verbatim push that lets a projects.json key de-dupe against a differently-spelled
history value); (2) `history/<name>/.project_root`, first-line-extracted, per-entry and
tolerant (a missing history dir, a non-directory entry, an unreadable subdir, or an
absent/blank/relative/multi-line `.project_root` is skipped or reduced, never thrown).
`add()` trims, takes the first line for history, strips a trailing slash, requires an absolute
path, and de-dupes; a symlink-spelling divergence (/tmp vs /private/tmp) is NOT collapsed
(that needs realpathSync; deferred, sources byte-identical in practice). `foundGemini` iterates
`geminisession.projects()`, so it now discovers history-only Gemini agents with ZERO change to
discover.js beyond one updated header comment (no new caller, no browser surface).

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
Added a `historyRoot` helper + 6 assertions (11 total in-file, all green). The de-dupe /
trailing-slash / blank-relative assertions call `geminisession.projects()` DIRECTLY, because
`foundGemini`'s own byDir de-dupe would mask a projects()-level defect and make a downstream
assertion vacuous (challenge-loop iter 1):
- a Gemini agent recorded ONLY in history/.project_root (absent from projects.json) is found.
- a cwd in BOTH sources is unioned ONCE (asserts projects() length; perturbation reds it when
  the seen-set de-dupe is removed).
- a trailing-slash divergence (/x vs /x/) de-dupes to one row (else the SAME agent shows twice).
- a multi-line .project_root reduces to its first-line cwd (no embedded-newline garbage cwd).
- a CRLF .project_root de-dupes cleanly (the \r is stripped by trim()).
- a missing/blank/relative .project_root leaves projects()===[] and never throws / no unreadable.
Perturbation (each done individually): reverting to projects.json-only reds the history-only
test; removing the seen-set de-dupe reds the de-dupe test; removing the trailing-slash strip
reds the trailing-slash test; removing the first-line extraction reds the multi-line test.
Restored 11/11 each time. Full suite green (no node-test failures; a VAL_EXIT=1 seen twice was
only the validation helper's dirty-worktree status while uncommitted edits were in flight, not
a test failure - resolved by committing before validating).

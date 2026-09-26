# files-recurse-2245: list subfolder files in "Files in this project" (bounded)

Card: kosmos#2245 (priority, claimed:icecreamkitty). Residual after the 0.6.90 closeout sweep:
the panel's source, engine/projects.js listFiles, read the project folder TOP LEVEL ONLY, so the
agent work that opened the card (a forecast PDF under weather-forecast-test/) never showed.

## Decision
Bounded recursion, as recommended on the card 2026-09-18 and not overruled since. Josh's goal is
to SEE what agents made; agents do not reliably save at the top level.

Rejected:
- Top-level only: hides exactly the file the card was filed about.
- Unbounded recursion: the panel polls this every few seconds; a node_modules tree would flood it
  and cost a full walk per poll.
- A foldered / expandable UI: nicer, but a UI design change (Mona/Josh). Relative paths in the
  existing flat list need no page change and do not block it later.

## What changes
1. listFiles walks subfolders breadth-first: depth <= 3 below the project, skips dot-entries
   and dependency, cache and build-output folders (node_modules, venv, env, __pycache__,
   dist, build, target, Pods, DerivedData). The top level
   is read in full as before; at most 2000 entries below it are read, and truncated:true is
   set if the walk stopped early. Subfolder files are named by their RELATIVE path with `/`
   (Windows too). Symlinked folders are never entered (dirent reports the link), so no loop
   and no escape; symlinked files stay unlisted. A programming error in the walk throws.
2. openFile gate 1 accepts that shape: a bare name or a relative path of plain segments. It
   refuses absolute (POSIX or Windows), backslash, empty segment, and any segment starting
   with `.` (covers `.`, `..`, hidden). Gate 3 (resolved target inside resolved folder) is
   unchanged and is what stops an escape through a link.
3. Page (web/index.html):
   - Both document views (the rail and View All) show a note when truncated is true, also
     when the cut-short walk found no files, and View All keeps it after a file is opened.
   - Citation chips: pjCiteKey matches a cited path on its LONGEST trailing run of segments
     that is in the list, and the chip opens that listed name. Used by pjLinkPaths and the
     room's pjRichSpans. Before, both matched the basename only, so a cite of
     sub/report.pdf opened a top-level report.pdf. A BARE name with no top-level file
     chips to the one nested file of that name, and to nothing when two share it.
     The room renderer decodes its escaped token before the lookup and escapes the listed
     name it gets back, because a folder name on disk can contain `"`, `<` and `&`.
4. Doc comments updated where they described top-level only / bare filename only.

Known residual: a cited file that is NOT listed (deeper than the walk, or skipped) but whose
basename matches a listed file still chips to the listed one, as every cite did before.

## Tests
engine/projects.test.js:
- nested files listed by relative path; names == files; no truncated flag on a small folder
- skip folders, hidden folders and depth 4 not walked; depth 3 and build/ are
- symlinked folder: not entered (out-of-project and self-loop); open through it refused
- a huge top level lists in full (2100 files, no truncated flag)
- a huge subfolder sorted first cannot push a top-level file off; truncated is set
- a listed nested file opens by its relative path
- the name-gate test plants sub/ok.txt so every segment attack is refused by the NAME gate
server.test.js: chips for a relative cite, an absolute cite and a bare name, in both
pjLinkPaths and pjRichSpans.
docs/browser-checks/render-docs-subfolders-2245.js: the real page, 14 assertions; 5 fail
against origin/main's page.
Mutations run: dropping the dot-segment rule, counting the top level against the budget, and
a basename-only pjCiteKey each turn the matching test red.

## Trade: build-output folders are skipped
Two reviewers disagreed. Walking build/, dist/, target/, env/ shows a file a person saved there
on purpose; skipping them keeps a fresh build's artefacts from filling a newest-first list and
setting the partial note on every code project. Skipped, because an agent's project folder is
often a code project and a deliverable saved into build/ is the rarer case. If that is wrong,
it is one line in LIST_SKIP_DIRS. `env` is in the list on purpose, as the common name for a
Python virtualenv, at the same cost for a folder of real notes called env/.

## Weakest premise
That relative paths in a flat list read well enough. Deep paths are long in a narrow rail. If Josh
or Mona want folders shown as folders, that is a UI follow-up on top of this, not a reason to keep
hiding the files.

## Not in this change
The live-spawn adherence check (does a Claude / OpenAI agent actually save into the folder each
time) stays on the card as a live-app test.

## Merge with main (09-26 03:33) and round 7 review (opus): 2 WARNINGs, 1 NIT
Merged origin/main (677 commits); three conflicts resolved (openFile's refusal takes main's `where`; browser-checks list; both page helpers in server.test.js).
- [WARNING] main's #3614 agent page Files list shares listFiles, so it silently started walking subfolders, without the partial note, while the agent's own instructions (engine/dmfiles.js) say to save directly in Files because that page lists only the top. DECIDED: that list stays FLAT. listFiles takes `{ maxDepth: 0 }` and the agent route passes it; its comment says so. Only a PROJECT's list walks subfolders. Test: a sub/deep.txt in an agent's Files is not listed. Control (no maxDepth) fails by name.
- [WARNING] the instructions every agent gets said "Kosmos lists only the top of a project's folder", now false. FIXED: "Kosmos lists a project's subfolders too, a few folders deep". dmfiles.test.js pins the new sentence and refuses the old.
- [NIT] a Windows-style cite (sub\report.pdf) never chipped. FIXED: pjCiteKey normalises backslashes for the lookup only (the chip carries the listed name; the '..' refusal still runs first, and its test with '..\brief.md' still passes). Test and control fail by name.

## Round 8 review (sonnet): 1 WARNING, not taken; converged
- [WARNING] normalising backslashes in pjCiteKey means a cite of a file literally named `budget\notes.txt` (legal on macOS) no longer chips. NOT TAKEN, premise checked: openFile's gate 1 refuses any name containing a backslash (on main too: `given.includes('\\')`), so that chip's Show me could never open the file; before this change it was a chip that always failed. Plain text is the honest rendering. No other finding: converged.

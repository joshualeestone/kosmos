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
   and folders that are never output (node_modules, venv, __pycache__, Pods, DerivedData;
   build/dist/target/env ARE walked because people save real output there). The top level
   is read in full as before; at most 2000 entries below it are read, and truncated:true is
   set if the walk stopped early. Subfolder files are named by their RELATIVE path with `/`
   (Windows too). Symlinked folders are never entered (dirent reports the link), so no loop
   and no escape; symlinked files stay unlisted. A programming error in the walk throws.
2. openFile gate 1 accepts that shape: a bare name or a relative path of plain segments. It
   refuses absolute (POSIX or Windows), backslash, empty segment, and any segment starting
   with `.` (covers `.`, `..`, hidden). Gate 3 (resolved target inside resolved folder) is
   unchanged and is what stops an escape through a link.
3. Page (web/index.html):
   - Both document views (the rail and View All) show a note when truncated is true.
   - Citation chips: pjCiteKey matches a cited path on its LONGEST trailing run of segments
     that is in the list, and the chip opens that listed name. Used by pjLinkPaths and the
     room's pjRichSpans. Before, both matched the basename only, so a cite of
     sub/report.pdf opened a top-level report.pdf.
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

## Weakest premise
That relative paths in a flat list read well enough. Deep paths are long in a narrow rail. If Josh
or Mona want folders shown as folders, that is a UI follow-up on top of this, not a reason to keep
hiding the files.

## Not in this change
The live-spawn adherence check (does a Claude / OpenAI agent actually save into the folder each
time) stays on the card as a live-app test.

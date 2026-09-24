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
1. listFiles walks subfolders: depth <= 3 below the project, skips dot-entries and
   dependency/build/cache folders (node_modules, venv, env, __pycache__, dist, build, target, Pods,
   DerivedData), reads at most 2000 directory entries, and sets truncated:true if it stopped early.
   Subfolder files are named by their RELATIVE path with `/` (Windows too). Symlinked folders are
   never entered (dirent reports the link), so no loop and no escape; symlinked files stay unlisted.
2. openFile gate 1 accepts that shape: a bare name or a relative path of plain segments. It refuses
   absolute (POSIX or Windows), backslash, empty segment, and any segment starting with `.`
   (covers `.`, `..`, hidden). Gate 3 (resolved target inside resolved folder) is unchanged and is
   what stops an escape through a link.
3. Doc comments on both functions updated (the old ones said top-level only / bare filename only).

No page change: the panel renders f.name with textContent and sends dataset.doc back to open-file
unchanged, so a relative path works end to end. Room citation chips still match only what the
server lists; a message that cites a subfolder file by basename stays plain text, as today.

## Tests (engine/projects.test.js)
- nested files listed by relative path; names == files; no truncated flag on a small folder
- noise folders, hidden folders and depth 4 not walked; depth 3 is
- symlinked folder: not entered (out-of-project and self-loop); open through it refused (gate 3)
- scan budget: 2100 files -> truncated:true, total <= 2000
- a listed nested file opens by its relative path
- the name-gate test now plants sub/ok.txt so every segment attack is refused by the NAME gate
  (15 bad shapes), with the existing control
Mutation check: dropping the dot-segment rule turns that test red (and only that test).

## Weakest premise
That relative paths in a flat list read well enough. Deep paths are long in a narrow rail. If Josh
or Mona want folders shown as folders, that is a UI follow-up on top of this, not a reason to keep
hiding the files.

## Not in this change
The live-spawn adherence check (does a Claude / OpenAI agent actually save into the folder each
time) stays on the card as a live-app test.

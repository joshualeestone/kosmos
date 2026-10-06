# previewsweep-5254: a cached PDF first page goes when its PDF, project or agent goes (#5254; stacked on #5119)

**Finished means:** a picture of a PDF's first page in the board's preview cache does not outlive the PDF, its
project or its agent by more than the next sweep (at most an hour; at once after a project removal or a new render).

## Change
- engine/filepreview.js: each cache folder gets source.json (0600, tmp+rename), written only beside a page that
  exists: the resolved path and the owner ({kind: project|agent, id}). sweep() removes a folder whose file is no
  longer a regular file at that path, whose project is no longer listed, whose agent is in the removed list, or that
  has no readable record (drawn before this; cheap to redraw).
- server.js: both routes pass the owner; sweep at board start, hourly (unref'd), after a project is removed.

## Decided
- A live-state sweep (file, project list, removed list) over hooking every removal path: agent removal runs through
  several paths (engine/remove.js); the hourly sweep covers them all and a deleted PDF too, which no hook sees.
- Rejected keying the cache by owner only: a deleted PDF in a live project would still stay.
- An unreadable removed-agents list skips that check (never read as "nobody removed", never as "everybody").

## Weakest premise
That at most an hour's lag after an agent's removal or a PDF's deletion is acceptable (a page is never SERVED for a
gone file, since the resolver runs first; this is only about what stays on disk).

## Tests
server.preview-sweep-5254.test.js: record mode and owner; deleted PDF swept with a kept control; removed project
swept (its files stay) with a before-removal control; removed agent swept, unreadable list kept, another agent's
removal kept; no-record folder swept; failed render leaves no folder; wiring. Mutants on each of the three checks
turn a test red. After the rebase onto #5119's ddef70dae (April fixed the pre-existing engine.reachable red):
related tests + guards 1092/1092.

## Review 1 (opus, blind)
- [BLOCKER] a sweep during a FIRST render (no record yet) deleted the render: FIXED, a folder with a render in it
  is skipped and an unrecorded one is left until 10 minutes old; test (sweep from inside the renderer) + mutant.
- [WARNING] synchronous lstat per folder can stall on a hung network drive: documented as a known cost.
- [NIT] record recreated after a mid-render sweep: FIXED (only beside a page that exists). [NIT] agent names compared
  cleaned: FIXED + test. [NIT] no-record test control: added. [NIT] agent removal waits for the hourly sweep: decided.

## 10-06: rebased onto main after #5119 merged; review 2 (second reviewer)
- Rebased with --onto past the merged #5119 commits; one conflict in server.js start(): #5247's snapshotWorlds() and
  this card's sweep both open start(); kept both, snapshot first.
- Review 2 WARNINGs, all fixed with tests and controls (each new arm fails on the previous filepreview.js):
  1. A symlinked cache folder: the sweep would remove old record-less folders wherever it pointed. Now sweep() runs only
     when the cache folder itself is a real folder (lstat).
  2. A render folder left by a crash shielded its cache folder, and its full copy of the PDF, forever. Now a render
     folder protects only while its process is alive AND it is younger than YOUNG_MS (by the real clock, not deps.now);
     otherwise it is removed on the spot and the folder is judged as any other.
  3. No test for an unreadable projects list. Added: it keeps project pages; CONTROL: an empty list sweeps them.
- NIT fixed: the unreadable removed-agents test now names the agent, so only skipping the check keeps the page.
- NITs decided, kept: a PDF reachable by two owners keeps the last viewer as owner (no leak, the other still lists it);
  a removed agent whose folder remains gets a "could not draw" message for a page swept right after drawing (deleting
  is right; the wording is a follow-up, not this card).
- Verified: 55 files (every board-booting test, the preview, download and gate tests, the guards) 1257 pass, 0 fail.

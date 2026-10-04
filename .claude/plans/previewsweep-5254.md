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

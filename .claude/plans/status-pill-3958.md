# status-pill-3958: the agent page's status pill follows the poll (Josh 2026-09-26)

## Cause (measured on origin/main, chromium + webkit, sandboxed board, fixture flips)
openDetail was the only painter of #d-state. The 5s poll repainted the DM line (paintBusy) off the
fresh card but never the pill, so the pill froze at the state the agent had when the page opened:
opened idle -> Idle forever (chromium run); opened working -> Working forever (webkit run).

## The dots
The DM line's dots animated in all 10 measured transitions (12 distinct frames per 1.2s sample).
The static dash Josh saw is the pill's idle mark that never became the working dots, so the
"dots don't animate" report is the same defect. Weakest premise: that no other surface has a
separate static-dots bug; I could not reproduce one.

## Fix
- paintDetailState(a): the pill + #d-task block moved out of openDetail unchanged, called by
  openDetail and by the poll (`if (fresh) paintDetailState(fresh)`), off the same fresh card as
  paintBusy and swarmPagePaint: one sample for pill, dots and the card's green.
- The pill's innerHTML is written only when its markup changed (data-pill-key), so a steady working
  agent's dots are not rebuilt and restarted every poll (#3421's reason).

## Verification
- docs/browser-checks/render-agent-pill-3958.js, chromium + webkit, 30/30.
- Perturbation: the poll call removed -> 12 arms RED (pill stays Idle, no dots); the key guard
  removed (pill rewritten every poll) -> the same-nodes arm RED on both engines. The first version
  of that arm read currentTime and silently SKIPPED under the perturbation (a detached node reads
  null); it now compares node identity and asserts it ran.

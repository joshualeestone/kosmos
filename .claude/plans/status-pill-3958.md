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
  paintBusy and swarmPagePaint: one sample. CORRECTED after review: the pill and the DM line also
  share the stale-working rule (workingSampleIsStale); the grid card does not, so for the one poll
  after a reply lands the card can still say working while the pill says idle. Deliberate (see the
  comment in paintDetailState).
- The pill's innerHTML is written only when its markup changed (data-pill-key), so a steady working
  agent's dots are not rebuilt and restarted every poll (#3421's reason).

## Verification
- docs/browser-checks/render-agent-pill-3958.js, chromium + webkit, 30/30.
- Perturbation: the poll call removed -> 12 arms RED (pill stays Idle, no dots); the key guard
  removed (pill rewritten every poll) -> the same-nodes arm RED on both engines. The first version
  of that arm read currentTime and silently SKIPPED under the perturbation (a detached node reads
  null); it now compares node identity and asserts it ran.

# #3966 on the same branch: the agent page flashes every five seconds (Josh 2026-09-26 08:59)

## Cause (measured)
setThread rewrote the whole thread whenever its markup changed, and a relative time on any row
("51 minutes ago" -> "52 minutes ago") changed it. A sixteen-message thread spread over the last
hour was rewritten 5 times in 30s (every ~6s), replacing all 208 thread nodes, so every avatar,
preview image and reaction reloaded: the flash. The project room had the same gate (paintRoom's
`__lastRoom !== html`) and additionally marked the room seen on a time-only change.
Surveys that ruled things OUT first: the pill/avatar/busy line are not rebuilt per poll; with an
empty or two-message thread nothing on the agent page is rebuilt; the unfurl cache's image budget
(32 MB vs a 5 MB per-image cap) cannot evict previews in a way that flips per poll.

## Fix
- pjWhenLive(at): the time as <span class="mwhen" data-at>, used by all 7 thread row builders.
- threadShape(html): the markup with those words blanked; setThread and paintRoom rewrite only when
  the SHAPE changed, and otherwise refreshWhens() updates the words in place.

## Verification
- docs/browser-checks/render-thread-steady-3966.js, chromium + webkit, 8/8; raw-markup compare
  reds it on both engines (224/224 nodes replaced).
- web.thread-shape-3966.test.js (5): shape equality across time words, real changes still repaint,
  source pins on both painters, every thread time written through pjWhenLive.
- web.thread-scroll.test.js brings the two helpers across (it loads setThread by itself).

## Challenge-loop iteration 2
- The project member panel (#pj-msgs, via setLive) had the same flash and was missed by the first
  sweep: setLive now compares by shape too, and pjVerdict's time is a live span. Unit pins only.
- The remembered marker's switch to the latest card got a source pin (web.pill-remembered-3958).
- Seven web tests slice these functions and needed the new helpers; one asserted the old literal
  markup `msg-t">just now` and now allows the live span.

## Not measured
The room and the member panel are covered by the unit pins and shares the helpers; no browser check watches a room.
Josh's own thread was not read (it is his data on his Mac); the mechanism is reproduced, the
exact trigger in his thread is inferred.

## Challenge-loop iteration 3
- The pill's stale-sample downgrade now has a behavioural test (web.pill-remembered-3958: the real
  paintDetailState + workingSampleIsStale, stubbed labels); deleting the downgrade reds it.
- The pill/card one-poll split is stated in the code and above instead of claimed away.
- OUT OF SCOPE, carded: the device-ask rows (#ask-rows) rebuild every poll and lose focus -> #3978.
- NITs: the #3966 helpers moved below pjWhenPart (they had split it from its docblock); two comments
  that quoted the old raw compare; setLive refreshes times only when the markup has one.
- render-agentdm-3414.js (maps msg-t) re-run green on this branch: surface trailer on the commit.

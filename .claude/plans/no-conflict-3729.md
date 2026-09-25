# No "reports versus screen" sentence on any agent surface, and no slot for one (kosmos#3729)

Josh, 2026-09-25 07:32 CDT, testing 0.6.94, verbatim: "These are still showing these status messages
that I do not ever want to see 'Its screen shows a question its reports do not mention' and 'it
reported stopping, but it is still running'. I dont even what there to be a space on these to have
any message like this injected." Standing rule (#3529, this card): no agent-status diagnostic
sentences on agent cards, ever.

## Call
- **Engine (engine/status.js).** The engine still computes `conflict`: its record of reports and
  screen disagreeing, pinned in status.test.js. Neither card builder (panelessCard, snapshot)
  copies it to the board any more: `stateConflict: null` always. So an already-installed page on
  Mac or Windows, the old slot included, also shows nothing once its engine updates. The field
  stays in the payload as null so the card's shape (the golden-card test) does not change.
  `status.conflict` has no other consumer (searched engine/, server.js, bin/).
- **Page (web/index.html).** The grid card's `<div class="note">` conflict line, the agent page's
  `#d-conflict` element and its painter, and `conflictNote` are DELETED, not hidden. Nothing in the
  page reads `stateConflict`. The list row, org chart and project member boxes never rendered it.
  asSentence stays (the documents panel uses it).
- Out of scope, per the card: real problems a person must act on (out of credits, broken login)
  are #3723.

## Tests
- engine/status.no-conflict-3729.test.js: with comments stripped, every `stateConflict:` the engine
  writes is `null`, and there are exactly two (so a scan that found none cannot pass). Controls:
  the engine still computes the sentences, and `status.conflict` is never copied. Reverting one
  builder reds both tests.
- web.said-line.test.js: no conflictNote, no #d-conflict, nothing in the page reads stateConflict
  (control: the same scan sees `stateReported`). A planted member-box reader reds it. The #855
  test now pins the card without the note.
- docs/browser-checks/render-no-conflict-3729.js (21 arms, new): a sandboxed board, every
  `conflict:` sentence from engine/status.js INJECTED into every agent object on every /api
  response (counted, and shown to be in the page's own data). On the grid, list, org chart, agent
  page, Projects tab and one-screen layout, on Mac and Windows: none of the sentences shows, no
  #d-conflict, no card note slot, no empty note. Against main's page it fails 12 arms.
- server.test.js (the detail-badge prelude no longer lifts conflictNote);
  web.open-sentence-1199.test.js (the conflictNote-delegation test went with the function).

## Weakest premise
- The Projects member boxes are only covered by "nothing in the page reads stateConflict" (the
  fixture has no project with members), not by a render of a member box with the sentence injected.

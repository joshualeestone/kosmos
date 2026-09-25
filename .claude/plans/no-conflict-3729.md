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
  #d-conflict, no card note slot, no empty note. (Strengthened in review pass 1, below.)
- server.test.js (the detail-badge prelude no longer lifts conflictNote);
  web.open-sentence-1199.test.js (the conflictNote-delegation test went with the function).

## Weakest premise
- The Projects member boxes are only covered by "nothing in the page reads stateConflict" (the
  fixture has no project with members), not by a render of a member box with the sentence injected.

## Review pass 1 (opus): 0 blockers, 3 warnings, 4 nits
- W the unknown card still carried a note ("Not the same as idle. We cannot see this one, so we are
  not telling you it is fine."), and the check's "no card note" claim only held because its fixture
  had no unknown agent. **Call: removed it too.** It is an agent-status diagnostic sentence on a card,
  which this card's standing rule forbids ("no agent-status 'diagnostic' sentences on agent cards,
  ever"), and the "Can't tell" badge, dashed card, pill and screen-reader words still carry the state.
  **Weakest premise: this overrides an earlier ruling** (the pack's comment that an unknown card must
  carry its reason, pinned in server.test.js); restoring it is a one-line revert if Josh wants it
  back. The needs-trust card's note STAYS: it asks the person to act, which the card puts out of
  scope (#3723's category).
- W the injection index reset per response, so only the first two sentences ever reached the page,
  neither of them Josh's. Now indexed by the running total, asserted all 11 reached the page (the
  ternary OpenAI sentence included, which the first regex missed).
- W most arms failed on main only because of hidden cards and the always-present slot. Card notes now
  count only on visible cards; each surface asserts it is actually showing (view pressed, layout
  switched); an unknown and a needs-trust agent are in the fixture; the unknown agent's page is its
  own arm. Against main: 14 arms fail, the sentence itself on the grid and both agent pages.
- NITs fixed: stale comments in engine/status.js and web/index.html; the golden-card test now
  requires null; the said-line test's lrow "saidLine(" matched only its own HTML comment (no code
  calls saidLine, on main either), now pinned as what it is.

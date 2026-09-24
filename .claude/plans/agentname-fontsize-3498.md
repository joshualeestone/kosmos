# agentname-fontsize-3498 - Agent name font matches body-copy size

## Card
kosmos#3498 (Josh, 2026-09-23): the per-post agent/sender name in the conversation
views is a couple points larger than body copy and stands out too much. Make it the
same size as body copy in all three surfaces (consolidated project dialog, tab-view
dialog, individual agent messaging). Bold is fine to keep. ONLY the font size changes.

## Done-condition
The sender name (.msg-nm) renders at body-copy size (13px) with weight kept bold, in
all three conversation surfaces, verified on the real render in light and dark.

## The change
- web/index.html: `.msg-nm` font-size .9375rem (15px) -> .8125rem (13px, the --text-body
  13px the .msg-bd body inherits). font-weight:700 and everything else unchanged.
- One shared class covers all three surfaces: pjRoomRow (consolidated + tab dialogs) and
  dmRow (individual messaging) both emit the name as <b class="msg-nm">, styled only at
  that one rule (single source of truth, no per-view override exists).

## Verification
- docs/browser-checks/render-agentdm-3414.js extended: asserts .msg-nm computed
  font-size == 13px, == the bubble body-copy size, and weight >= 600, in light + dark.
- Positive control run: reverting to .9375rem reds the new assertions (15px, name=15
  body=13); restoring to .8125rem passes. The guard is not vacuous.
- Surface gate: render-agentdm-3414.js is the covering check for the msg-nm token and is
  updated in this same change (bc-surface-map covering confirms it is the only one).
- Full suite: 258 pass, 1 fail (environmental: Xcode license blocks the local-server
  test on this box, unrelated to a CSS value).

## Rejected
- Changing .dname / DNAME_BASE_REM (the big #d-name panel heading): that is a different
  element (a 24px identity heading, JS-shrunk by fitDetailName), not the per-post name the
  card is about. The card says "a couple points larger than body copy" = 15px, which is
  exactly .msg-nm, not the 24px heading.

## Weakest premise
That body copy in the bubble is exactly 13px. Confirmed: .msg-bd sets no font-size and
inherits body's --text-body (13px), and the check asserts name == bubble-body equality,
so a future body-size change keeps the two matched rather than silently drifting.

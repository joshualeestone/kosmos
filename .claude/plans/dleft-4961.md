# #4961 (c): the agent page's pills no longer sit on the Files card after a scroll

**Done looks like:** scrolling an agent's AI Settings (or any long section) never puts the Profile / AI
Settings pills on top of the Files card's header; the pills scroll with their column.

## Cause
`.snav { position: sticky; top: 16px; }` (#350, when the nav was alone in its column). #3385 put the
identity block above it and #3614 the Files card below it in the same column, so on a page scroll the
nav stuck while the card slid up behind its transparent gaps; `top: 16px` also tucked the pills under
the sticky app header (Josh's screenshot, 2026-10-01 22:17: Direct Message cut off, FILES behind the
pills).

## Change
- web/index.html: `#d-nav { position: static; }` with a why-comment. Settings keeps the sticky .snav:
  nothing sits below #s-nav.
- docs/browser-checks/render-nav-files-4961.js (+ README row, gated.txt).

## Rejected
- An opaque sticky band (background + a top below the header): the card would still slide under the
  pills, just hidden instead of showing through, and the header height is not a CSS value here.
- Making the whole left column sticky: identity + nav + files is taller than a laptop window.

## Evidence
- On main: AI Settings at 450 and 600px overlap on chromium and webkit (4 FAIL); Talk does not.
- With the change: all pass. render-agent-nav, render-talk-fill-2622, render-agent-files-3614,
  render-dm-chatfirst-718, render-settings-nav also pass on this branch.

## Weakest premise
That nobody needs the pills to stay on screen halfway down a long AI Settings page. Scrolling up
reaches them; if that proves annoying, the next step is a sticky nav with the Files card moved out of
its column, not a sticky nav over it.

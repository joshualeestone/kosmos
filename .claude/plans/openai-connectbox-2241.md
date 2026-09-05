# openai-connectbox-2241: OpenAI connected state = gold check-row box (like Claude)

## Card
kosmos#2241 (Josh 0.6.35): when an OpenAI/codex account connects, render the SAME gold check-mark
box Claude uses, reading "OpenAI GPT Codex is connected. This computer is signed in.", replacing
the plain "Added: API key ending X". Key last-4 stays as a secondary detail in the box.

## Change (web/index.html)
- frPaintOpenai connected branch: `msg.className='fr-connbox'; msg.innerHTML = frCheckRow({state:'ok',
  title:'OpenAI GPT Codex is connected', detail:'This computer is signed in.'+(keyTail?' (API key ending
  '+keyTail+')':'')})`. Reuses the SHARED frCheckRow builder Claude's frPaintSubscription uses (#1834
  name-it-once), so the two providers render identically.
- else branch: `msg.className='dhint'` before the dead-reason text, so leaving connected drops the box.
- markup: `#fr-openai-msg` p->div (a .fr-check block cannot nest in a p; Claude's #fr-sub is a div).
- CSS: `#firstrun #fr-openai-msg.fr-connbox { ... }` mirrors `#fr-sub:not(:empty)` (gold wash + border).
  Class-keyed, NOT :not(:empty), because #fr-openai-msg also carries the not-connected dead-reason.

## Decisions
- Reuse frCheckRow (not inline markup) so it can't drift from Claude's box.
- Class-keyed box, since the element carries both success and the dead reason.
- justAdded no longer branches the message (both connected states show the same box, per Josh); still
  clears the key field.

## Verified
- web.firstrun-model.test.js updated + 14/14 (frCheckRow stub threaded into the isolated evals; the
  connected assertions moved to innerHTML/className; one structural count fixed for p->div).
- docs/browser-checks/render-firstrun-openai-connectbox-2241.js (real frPaintOpenai connected): gold
  check-row box + "OpenAI GPT Codex is connected"/"signed in", gold bg+border, + a not-connected
  CONTROL that stays a plain hint. Headless PASS.
- Wired into runner (#1387); EXPECTED_SITES 44->45, EXPECTED_CATCH_SITES 26->27 (#1864); README (#612).
- Full web.*.test.js 1079/1079; mechanical gates green; no em dashes; no brand refs.

## Weakest premise
The unit test uses a frCheckRow STUB (not the real builder), so it proves frPaintOpenai's LOGIC, not
the real render; the real render (gold box, computed style) is proven by the browser check instead.

## Scope
First-run OpenAI connect box only. The Settings add-a-provider "Added" toast (web/index.html ~15867,
from #2095) is a different surface, out of scope.

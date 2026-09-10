# found-panels-gate-2651: gate the found/scan discovery panels behind an explicit action (kosmos#2651a)

Addresses kosmos#2651 part (a). Part (b), the getting-started SEED demo agents, is the seed owner's, NOT touched here.

## Problem

Landing on the Agents page auto-scans-and-shows the found-agents and scan-agents discovery panels ("We found agents on your computer"). No profile is written and nothing is imported (Renet reproduced: the panels only RENDER found candidates), but the candidate set was widened a lot by #2414 (arbitrary-named folders) and #2410/#2452/#2243 (Gemini), so the auto-appearing panel reads to the user as "Kosmos scanned my machine and imported all my agents." Josh flagged it as a big issue; it is live-cluttering the Mortals box before his MK-roster self-import. Angel's disposition re-scoped #2651 from an auto-import-create regression (that path is gone: #2497 shipped, the 5s poll is TCC-free per #2125 and only lists dismissable candidates) to this display/consent-UX issue.

## The fix (display/gating only, reversible, no profile writes)

Gate the two discovery panels behind an explicit user action, per Angel's recommended direction.

- `DISCOVERY_OPENED` (new module global, default false, NOT persisted): while false, `paintFoundBoard` and `paintScanBoard` render nothing and fetch nothing. A full page reload resets it, so the page never opens the panels for you.
- A new trigger row `#found-scan-trigger` with button `#found-scan-look` ("Look for agents already on this computer"). `paintDiscoveryTrigger()` shows it on the Agents tab whenever NO discovery panel is visible, and hides it once a panel renders candidates. Keyed on panel visibility, not on the flag, so it is also the resting state after a look that found nothing.
- Pressing the trigger sets `DISCOVERY_OPENED`, paints both panels, and (empty case) reports "No agents found on this computer to add".
- The trigger is wired into the same tab-gated poll that paints the panels (so its visibility stays correct), and hidden on the way off the Agents tab exactly as the two panels already are.

The existing per-panel Show/Hide fold (`FOUND_OPEN`/`SCAN_OPEN`) and "Dismiss this forever" are unchanged.

## Rejected

- Persisting `DISCOVERY_OPENED` (localStorage): rejected. Persisting "opened" would re-auto-show the panels on the next load, which is exactly the complaint. Each load starts collapsed.
- Removing the panels or the "Dismiss this forever" control: rejected. The found-agents feature is by design useful; the fix is to stop it AUTO-showing, not to delete it.
- Touching the getting-started seed (part b): out of scope; the seed owner's lane.

## Verification

- `docs/browser-checks/render-discovery-gate-2651.js` (new): hermetic file://, stubs /api/found-agents + /api/scan-agents, forces the Agents tab, drives the real paint functions. Two arms: ON LOAD both panels hidden + trigger shown; EXPLICIT PRESS opens both + hides the trigger. The load arm alone would pass on a page that never shows the panels, so the press arm is load-bearing. Proven can-fail: removing the `DISCOVERY_OPENED` gate reds the load arm.
- Four browser-check wiring guards reconciled up front: reason-grep finding-emit count (92->94) + catch/launch count (61->63) + quotability (the fail line is single-line so the release runner can quote it), and the README index (the new check is named).

## Weakest premise

I verified against the SOURCE web/index.html hermetically, not Josh's live Mortals build. The panels' data comes from /api/found-agents and /api/scan-agents, which I stubbed; the gate is pure frontend logic (a flag + a trigger), so source behaviour is what ships. If Josh's build shows panels via a DIFFERENT path than paintFoundBoard/paintScanBoard, the gate would miss it, but those are the only two renderers of the found/scan candidate panels.

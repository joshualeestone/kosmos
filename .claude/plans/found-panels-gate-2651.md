# found-panels-gate-2651: gate the found/scan discovery panels behind an explicit action (kosmos#2651a)

Addresses kosmos#2651 part (a). Part (b), the getting-started SEED demo agents, is the seed owner's, NOT touched here.

## Problem

Landing on the Agents page auto-scans-and-shows the found-agents and scan-agents discovery panels ("We found agents on your computer"). No profile is written and nothing is imported (Renet reproduced: the panels only RENDER found candidates), but the candidate set was widened a lot by #2414 (arbitrary-named folders) and #2410/#2452/#2243 (Gemini), so the auto-appearing panel reads to the user as "Kosmos scanned my machine and imported all my agents." Josh flagged it as a big issue; it is live-cluttering the Mortals box before his MK-roster self-import. Angel's disposition re-scoped #2651 from an auto-import-create regression (that path is gone: #2497 shipped, the 5s poll is TCC-free per #2125 and only lists dismissable candidates) to this display/consent-UX issue.

## The fix (display/gating only, reversible, no profile writes)

Gate the two discovery panels behind an explicit user action, per Angel's recommended direction.

- `DISCOVERY_OPENED` (new module global, default false, NOT persisted): while false, `paintFoundBoard` and `paintScanBoard` render nothing and fetch nothing. A full page reload resets it, so the page never opens the panels for you.
- A new trigger row `#found-scan-trigger` with button `#found-scan-look` ("Look for agents already on this computer"). `paintDiscoveryTrigger()` shows it on the Agents tab whenever NO discovery panel is visible, and hides it once a panel renders candidates. Keyed on panel visibility, not on the flag, so it is also the resting state after a look that found nothing.
- Pressing the trigger sets `DISCOVERY_OPENED` and paints both panels. An empty look shows no separate message: the trigger simply stays as the re-look affordance (keyed on panel visibility). This deliberately avoids a click handler that cannot tell "the look found nothing" from "the look could not be completed", which would misreport a failed fetch as an empty result.
- When the press opens a panel the trigger row hides, which holds the pressed button, so keyboard focus is moved into the opened panel (the found toggle, or the scan toggle if found is not shown) rather than dropping to `<body>`. On an empty look the trigger stays and focus stays on the button for an easy re-look.
- The trigger is wired into the same tab-gated poll that paints the panels (so its visibility stays correct), and hidden on the way off the Agents tab exactly as the two panels already are.

The existing per-panel Show/Hide fold (`FOUND_OPEN`/`SCAN_OPEN`) and "Dismiss this forever" are unchanged.

## Rejected

- Persisting `DISCOVERY_OPENED` (localStorage): rejected. Persisting "opened" would re-auto-show the panels on the next load, which is exactly the complaint. Each load starts collapsed.
- Removing the panels or the "Dismiss this forever" control: rejected. The found-agents feature is by design useful; the fix is to stop it AUTO-showing, not to delete it.
- Touching the getting-started seed (part b): out of scope; the seed owner's lane.

## Verification

- `docs/browser-checks/render-discovery-gate-2651.js` (new): hermetic file://, stubs /api/found-agents + /api/scan-agents, forces the Agents tab, drives the real paint functions. Six arms: (1) ON LOAD both panels hidden + trigger shown; (2) EXPLICIT PRESS opens both (found and scan each asserted), hides the trigger, and moves keyboard focus into the opened panel (activeElement lands on #found-toggle, not body); (3) DISMISSED FOREVER does not re-offer the trigger, and focus falls back to the Agents tab rather than a stranded body once the trigger vanishes; (4) EMPTY LOOK keeps the trigger shown and returns focus to the trigger button; (5) ONLY SCAN VISIBLE focuses the scan toggle (the fall-through focus branch); (6) TAB-SWITCH RACE (gate the fetch, flip off the Agents tab mid-flight, release) does not yank focus back to Agents. The load arm alone would pass on a page that never shows the panels, so the press arm is load-bearing. Proven can-fail: removing the `DISCOVERY_OPENED` gate reds arm 1; a scan-only regression reds arm 2's scan assertion; removing the focus move reds arm 2's focusId assertion; a wrongly-tracked dismissed flag reds arm 3; dropping the tab fallback reds arm 3's focus and dropping the button refocus reds arm 4; dropping the scan-toggle branch reds arm 5; dropping the onAgentsTab guard reds arm 6.
- Robustness on the interactive path (challenge-loop review): the two discovery fetches carry `AbortSignal.timeout(8000)` (the file's own convention) so a hung backend cannot leave the disabled "Look for agents" button stranded until a reload; the poll, showTab, and press paths run `paintFoundBoard`/`paintScanBoard` via `Promise.all` (concurrent, restoring the pre-gate concurrency) and sequence `paintDiscoveryTrigger` after both settle; and the press's focus restoration is guarded on `onAgentsTab()` so a tab switch during the fetch cannot yank focus back to a tab the person left.
- Hermetic scan-panel gate coverage: `web.found-board.test.js` gained a `paintScan` harness with a #2651 gate test (opened:false -> scan-wrap hidden, zero /api/scan-agents fetch) and a can-fail control (opened:true -> shown + fetched), so the scan half of the gate is covered without Playwright (the browser check SKIPs when Playwright is absent). The showTab off-Agents-tab trigger-hide is asserted alongside the found-wrap/scan-wrap hides in that file's tab-switch test.
- Four browser-check wiring guards reconciled up front: reason-grep finding-emit count (92->94) + catch/launch count (61->63) + quotability (the fail line is single-line so the release runner can quote it), and the README index (the new check is named).

## Known residual (accepted, decided in review)

A person who pressed "Dismiss this forever" in a prior session is re-offered the "Look for agents" trigger once on each fresh page load, until they press it and the fetch re-teaches the dismissal (DISCOVERY_DISMISSED is learned only from a fetch, and the gate defers all fetches until the press). Decided to ACCEPT this rather than persist a dismissed flag in localStorage: the plan deliberately keeps the gate stateless on load (persisting "opened" is what caused the auto-show complaint), a press-gated trigger reappearance is a materially smaller thing than the auto-scanning panel this card removes, and persisting a second piece of discovery state widens scope past the consent fix. The one real hazard in that path, focus being stranded when the trigger vanishes after the dismissing press, is fixed and guarded (arm 3: focus falls back to the Agents tab). This is a Kosmos product call and is mine to make; not routed to Josh.

Second decided point: once the user presses "Look for agents", DISCOVERY_OPENED stays true for the rest of the page session, so the 5s poll keeps discovery live and a candidate that appears LATER in the same session (a new agent folder) auto-shows without a fresh press. Decided to ACCEPT this. The card's complaint is specifically the auto-scan-and-show ON LOAD (before any action), which reads as an unconsented import; the explicit press is the consent, and after it the panel behaving as it always did (the poll surfacing new candidates) is serving what the user opted into, not violating it. A fresh page load resets DISCOVERY_OPENED to false, so the on-load complaint stays fixed. Making each press a single discrete look instead (resetting the flag after an empty result) would be a larger behavior change than the card asks for. Mine to call; not routed to Josh.

## Weakest premise

I verified against the SOURCE web/index.html hermetically, not Josh's live Mortals build. The panels' data comes from /api/found-agents and /api/scan-agents, which I stubbed; the gate is pure frontend logic (a flag + a trigger), so source behaviour is what ships. If Josh's build shows panels via a DIFFERENT path than paintFoundBoard/paintScanBoard, the gate would miss it, but those are the only two renderers of the found/scan candidate panels.

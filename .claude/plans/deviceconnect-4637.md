# #4637: "another device wants to connect", redesigned (Mona Lisa's design)

Card: joshualeestone/kosmos#4637. Design and spec by Mona Lisa (card comment 5898120682, mock Josh-Brain/Projects/kosmos-design/kosmos-device-connect-2026-09-29.html); built by PigeonPete, STACKED on #4610 (plusasks-4610). Josh wants screenshots before it ships.

## Built
- The notice (every view but Kosmos Plus): #askcard is now the navy Kosmos+ card centred under the header: device icon, the Kosmos+ mark, "<who> wants to connect", "<browser / Kosmos app> · when", gold Review. Several: "N devices want to connect".
- Review opens the approval sheet (#kp-modal, role=dialog, aria-modal) over the page, not Settings; focus on Allow, Tab stays inside, Escape closes and returns focus to Review. A bottom sheet with a grab handle at 600px and below.
- The card (kpCard), the same in the sheet and inline on Kosmos Plus: mark, icon, headline, subtitle, "Asked again" amber note after a No, "Make sure <who> is showing this code" with the code ONCE as large text (no devCodeHtml boxes), gold Allow (the only gold control), quiet "Not me", the fine print. An old request says "Asked 3 hours ago" instead of fading.
- Results: Allow -> "<who> is connected", "It will open your Kosmos in a moment.", Done, "See your devices"; Not me -> "<who> was kept out" with the password sentence for a fresh request only (#3829's rule kept). Done moves the sheet to the next request, and it closes when none is left.
- Your devices: each row has its icon, a red-outlined Remove, and a gold ring for a few seconds on the one just allowed.
- Words (kpWords), from the one name the device sends: "<computer> (Kosmos app)" -> "<computer>", "Kosmos app"; "Windows PC · Edge" (the web sign-in's kinds, signin.html deviceNameFor) -> "Your Windows PC", "Edge"; "Browser" / none -> "A browser".

## Decided
- Mona's gold and navy over the 09-16 "gold is regular Kosmos only" note in the old CSS: her spec takes it from the Plus panel's own navy and gold, and Josh sees screenshots before it ships. Named here so it is his call if it matters.
- The engine suffix change (platform in "(Kosmos app on Windows)") is left out: optional in the spec; the subtitle says "Kosmos app · when", which is true.
- #askcard stays in the page flow (centred, shadowed), not position:fixed, so the layout rules that make room for it (#3040's gap) keep working.

## Tests
- New gated check render-device-connect-4637 (31): words table, both boards, the sheet, results, several requests, device rows, phone bottom sheet; saves screenshots when given a folder.
- Re-pinned to the new design, each keeping its protective intent: web.allow-card.test.js (no device id in text, the password sentence only where true, no browser confirm(), no left bar, 44px), render-plus-panel-3829 (95 pass), render-plus-asks-signin-4610.
- Also pass: render-waiting-phone-718, render-dm-chatfirst-718, render-talk-fill-2622.
- Found on #4610 while building this: render-waiting-phone-718 still pinned #3829's placement that #4610 reversed; fixed on #4610's branch (a4fe66126).

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

## Colour correction (Mona Lisa, 15:5x): Josh's 09-16 ruling stands
Kosmos+ blue, never gold: Review and Allow use the shipped Kosmos+ primary (#3a68d8 -> #2f57c4, white, 1px #2f57c4, a blue shadow); the device-icon circles and the just-allowed ring are blue (ring rgba(126,160,240,.45), fill rgba(65,113,227,.12), stroke #9cc0ff). The KOSMOS+ wordmark keeps its own dots. The check asserts Allow is the only filled control and that it is blue.

## Blind review round 1 (Opus, separate reviewer)
WARNINGs fixed, each with a check arm that fails its mutant:
- The sheet moved to another device by itself (the allowed result cleared after 6s, or the shown request stopped waiting, and the next device's Allow took its place). Now it stays on the device Review or Done put there: a result stays until Done, a request that stops waiting says "... is no longer waiting" with Close, and only Done moves on (focus on the next Allow).
- After Allow / Not me focus fell to the page: it goes to the result's button; Tab from outside re-enters the sheet in both directions.
- Closing with no request left sent focus to a hidden Review: it goes to the current view's nav tab.
- No way out without deciding for a screen reader on a phone: a visible Close button (an addition to the design, told to Mona Lisa).
NIT taken: a request with no name at all reads "A device", not "A browser" (the web sign-in always sends a name). Accepted NIT: the sheet's headline may be read twice on open (dialog label plus the live region).

## Mona Lisa's design approval (16:0x) and two NITs, fixed
Approved: the blue everywhere, the Close x, "no longer waiting", "A device" for a nameless request. Fixed: the notice's subtitle broke early (a `.kp-t span` rule made the nested time a block); now only the direct line is a block and each "part" is nowrap, so a wrap carries the dot with the time (check: one line per part, one line on desktop; fails on the old rule). The sheet's body text is line-height 1.45.

## Blind review round 2 (Sonnet, separate reviewer)
WARNINGs fixed, each with a check arm that fails its mutant:
- A failed Allow / Not me made the request unreachable (askLive dropped `error`): an error now still waits (notice, dot, Review), and closing the sheet on it forgets the error.
- A device kept out could never ask again this session (`denied` / `gone` never cleared): cleared once the device is no longer listed (after a minute, never while the sheet shows it), or at once when the same device asks again after the answer.
- A double press sent two answers: an in-flight guard (ASK.busy).
- Reasoned, not measured: a poll between the tunnel dropping the request and our own answer arriving showed "no longer waiting"; while our answer is in flight the card stays (ASK.busy).
Accepted NIT: the page behind the sheet is not `inert` (Tab is trapped; a screen reader's virtual cursor can still leave).

## Blind review round 3 (Opus, separate reviewer)
Two WARNINGs fixed, each with a check arm that fails its mutant:
- Got it on "kept out" stamped the dismissal with the press time, so a re-ask made while the result was being read (first_seen between the answer and the press) stayed hidden for as long as it waited. Got it keeps the answer's own time.
- Done put focus straight on the next device's Allow, so a second Done press or a held key could allow a device the person had not looked at. Done now focuses the sheet.

## Blind review round 4 (Sonnet, separate reviewer)
Two WARNINGs fixed, both arms failing on the previous commit's page:
- A re-ask was told apart by comparing the relay's first_seen with the page's clock, so a Mac clock ahead of the relay hid it. Each answer now stores the first_seen it answered (`asked`); a listed device with a DIFFERENT first_seen is a new request. No clock comparison.
- Closing the sheet on an allowed result (Escape, backdrop, See your devices, Kosmos Plus) deleted it, and the 6s expiry deleted it whether or not the device was still listed, so a lagging listing brought an answered device back with Allow on it. Closing turns a result into `gone`, and an answer is forgotten only once the device is no longer listed (after 6s allowed / a minute kept out).
NIT (accepted): navigating to Kosmos Plus with the sheet on a fresh Allowed result closes it; the device row and its ring still show it.

## Blind review round 5 (Opus, separate reviewer): nothing above NIT. Converged.
Walked: an allowed device leaves the listing within one tunnel poll (allow list + grant); a kept-out one drops at once; a re-ask gets a new first_seen only from denied; first_seen is NOT NULL and stable. The notice, the inline cards and the sheet read the same state.
Accepted NIT: an Allow whose coordinator ack FAILED, followed by Remove within the kept window, leaves the re-listed request hidden (same first_seen) until the page reloads; it needs a failed ack plus a Remove of that very device.
Next: full validation after #4610 lands (stacked), then PR.

# #2531 - removal-verb consistency: the Disconnect armed-confirm says "Disconnect?", not "Remove it?"

## The finding (Mona Lisa, Settings copy review)
In AI Models, a destructive button changes verb when armed:
- "Disconnect" button armed to read "Remove it?" - a different verb for the same reversible act.
- "Delete and remove" button armed to "Delete for good?".
The Global skills / AI policies sections use "Remove" + "Remove it for good?" (self-consistent).

## The pinned rule
The armed confirm echoes the button's OWN verb; append "for good" only for the irreversible act (the code already encodes "for good == irreversible": a reversible Disconnect deliberately does not say it, because a rename survives and its success sentence says so). So:
- Disconnect (reversible) -> "Disconnect?"   [THE fix; was "Remove it?"]
- Delete and remove (irreversible) -> "Delete for good?"   [unchanged; echoes the lead verb + the irreversibility marker]

## The change (one line)
web/index.html: `const CONFIRM = isRemove ? 'Delete for good?' : 'Disconnect?';` (was 'Remove it?').

The shared #2264 handler applies CONFIRM to BOTH the armed textContent AND the aria-label (`aria-label = CONFIRM + ' ' + REST_LABEL`), so the #2264 accessible-name match is automatic - there is no separate aria-label to edit, and no drift is possible. Both the Claude and OpenAI Disconnect buttons run through this one shared handler, so the OpenAI-side confirm is corrected by the same line - no touch to ICK's #2568 pill or the OpenAI reauth-suppression (per her settled anchors).

## Scope boundary
Not changing the "Delete and remove" button copy or its "Delete for good?" confirm (it echoes its lead verb + the irreversibility marker, which is correct). Not touching the Global-skills / AI-policies "Remove it for good?" sibling.

## Test
web.ask-first-1683.test.js pins the Disconnect armed confirm; updated its assertions + comment examples from "Remove it?" to "Disconnect?". The "Remove it for good?" sibling reference and the other account tests (web.account-qualifier, web.provider-groups-1393, web.layout-picker) are untouched and pass.

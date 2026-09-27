# checkgreen-tip-4139: a green or refusal from a check says so, not "a real request"

kosmos#4139, filed by me from the #4064 review; claimed while the #4108 re-land waits on Baron's revert (told Liu Kang).
In Settings, AI Models, a green pill says in its title "a real request on this account succeeded recently ... This is
an observed outcome, not a probe." and its pill reads "Signed in · active 2m ago". Since #3136 (Claude Check now), #3997
(Grok's free check) and #4064 (ChatGPT's free check) a green can come from a check Kosmos ran, where both sentences are
false: no agent made a request, and the check IS a probe. A refusal from Claude's Check now likewise reads "a real
request on this account was rejected".

## Done looks like
A green that came from a check says so in its title and its pill ("this sign-in answered when Kosmos checked it",
"Signed in · checked 2m ago"); a refusal from a check says it was refused when checked; an agent-derived green or
refusal keeps today's words. Server tests prove the field on all three providers, and the browser check proves the
rendered title and pill, failing on main's page.

## Change
- server.js, the three /api/accounts overlays (Claude, OpenAI, Grok) already pick the newest of the agent observation and
  the check observation. They now also return `observedFrom: 'check' | 'agent'`, naming the one that won (only when an
  observation decided the badge).
- web/index.html, the accounts row render: `fromCheck` picks the title for `working` and `rejected`, and the pill's
  age word ("checked" instead of "active") for `working`.

## Rejected
- Wording that says the check is free: Grok's and ChatGPT's are, Claude's Check now is a real `claude -p` call, so the
  shared sentence does not make a cost claim.
- A separate badge value ('checked'): every consumer of `badge === 'working'` (the create form's account picker, the
  green) would need teaching; a separate field changes only the words.

## Weakest part
The pill change ("checked" for "active") goes one step past the card's "tooltip" wording; it is the same falsehood in
the visible text, so it is included and called out in the PR. The "rejected" pill word stays: a check that was refused
is rejected.

## What would change my mind
Josh preferring the pill to keep one word for both sources.

# openai-dead-1561: refuse a switch onto OpenAI when every sign-in is dead (#1561)

## Problem
Switching an agent onto OpenAI, on a computer whose OpenAI sign-ins are all dead
(every connection.state is 'none'), stated a default onto a dead account instead
of refusing. The page's picker filters live accounts (state !== 'none'); when all
are dead the filtered list is empty, the picker hides, and changeProviderNow sends
account:null. The engine's openai.list() has no liveness filter, so on account:null
it takes its first account, dead or not, and names it.

## Fix (page-side, web/index.html)
The page is the only caller of /api/agent/<id>/provider, so the fix lives here.

- `openaiAllDead(accounts, unreadable)`: shared, pure predicate. Keeps THREE
  states apart: zero accounts (false; engine keeps its own add-an-account remedy),
  all dead (true; refuse), and unreadable (false; "we could not read it" is not
  "we checked and none works", so the refusal never fires on a healthy machine).
- `fillSwitchAccounts`: when all dead, show SWITCH_ACCT_ALLDEAD (distinct from the
  existing SWITCH_ACCT_UNREADABLE), chained as an else-if so the third state cannot
  collapse into it.
- `changeProviderNow`: guard on `want === 'openai' && openaiAllDead(...)` and refuse
  before the fetch, rather than submit account:null.

## Tests
`web.openai-alldead-1561.test.js`: extracts openaiAllDead and drives it through all
three states with controls (each control can return the other value), plus source
pins that both call sites are wired to it and that the guard returns before the
fetch. Mutation-verified: defeating the unreadable guard reds only the unreadable
test; inverting the core reds four.

## Rejected / follow-up
- Engine defense-in-depth (setProvider re-checking liveness itself) is a follow-up,
  not this card: it needs setProvider to go async (checkLive is a network /models
  call, free but not local) and it touches create.js (#1539) and the #1600
  switch-default contract. For a local app whose only caller is this page, the page
  fix resolves the user harm; the engine guard is belt-and-suspenders for a
  direct-API caller.

## Coordination
Collision-checked with Angel: web/index.html untouched by her branch. #1600
(home pin-vs-track) is orthogonal and not settled here.

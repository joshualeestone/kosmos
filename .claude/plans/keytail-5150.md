# keytail-5150: Gemini and Grok accounts are named by their key in every account bracket

Card: joshualeestone/kosmos#5150 (from #5145's review 2; not day-one).

## Change
`acctParenthetical` (web/index.html) names an account `name || email || label`. A Gemini or Grok key account has
none of the three (the default row has a null label), so every bracket that goes through it ("Right now: Gemini",
the account row, the reopen) showed nothing. It gains a last rung: `keyTail` as "API key ending XXXX", the server's
own wording (server.js 1835, 7939; the engine's sentence "your Gemini account (API key ending XXXX)").

## Tests (web.runson-name-2225.test.js)
- a key account with no name, email or label reads "API key ending 4f2a";
- the key is the LAST rung: a name, an email or a label still wins;
- CONTROL: a row with nothing (keyTail null or '') still gives no bracket.
Mutant (the rung removed): 1 red, the first test; the other two hold by design. Both lifting tests green (46/46
with the lints).

## Not in this branch
The card asks to "pin a Gemini row" in a check: the pure-helper test pins it; no browser check asserts this bracket
today (grep shows acctParenthetical lifted only by server.test.js 3689 and two web tests, which still pass).
Merge: after Monday, with validation and tools/browser-checks.sh on its exact head (Splinter's 07:53 rule: web/).

## Weakest premise
That `a.account.keyTail` is set wherever the bracket is painted: server.js 2021 sets it on the agent's account, and
the reopen passes the accounts row, which carries keyTail (server.js 1603-1653). Not measured in a browser yet.

## Review 1 (blind Sonnet): CONVERGED, 0 blocker, 0 warning, 0 nit
- Callers (web/index.html 37047, 48356) wrap the result in parentheses and never add the key themselves; the
  other "API key ending" prints are separate surfaces, so no row shows the key twice.
- Subscription accounts carry keyTail null (openaiaccounts.js 145, grokaccounts.js 166, server.js 9577/9596), so
  no subscription row can say "API key ending".
- Wording matches server.js 7939; the server.test.js slice and the two web tests still hold (17/17 run).
- No browser check asserts this bracket for a Gemini or Grok agent.

## Review 2 (blind Opus, on main merged in, 6b62add70a): 1 BLOCKER, 3 WARNING, 1 NIT
- BLOCKER: /api/status builds `a.account` from the Claude list (accounts.list()), so a Gemini/Grok agent's row
  has no keyTail and the open-the-agent paint ("Right now") never showed the key; only the switch repaint did.
  -> FIXED client-side: acctWithListedKey adds keyTail from ACCOUNTS (/api/accounts, per provider) by folder.
  Rejected: a server change in /api/status, which would need the Gemini/Grok lists each 5 s poll (their list is
  the live-checked one).
- WARNING (the switch repaint vs the open paint disagreeing): fixed by the same.
- WARNING (tests only fed hand-made rows): unit test for acctWithListedKey with the status shape and controls,
  plus a source pin that the paint site goes through it.
- WARNING (bracket vs picker order for named-slug key accounts): DECIDED, pre-existing, stated in the comment.
- NIT (OpenAI API keys too): comment says so.
Weakest premise now: ACCOUNTS is loaded when the agent's page opens; if not, the bracket is omitted as before
(nothing wrong is shown). A default-account Gemini/Grok agent has no folder to match and stays without a bracket.

## Reviews 3 and 4 (Sonnet, Opus): the client-side join was the wrong layer
- Review 3: a session's FIRST open showed no key (ACCOUNTS not read yet). Patched with an accountsRead hook.
- Review 4: three WARNINGs from the same root. The join copied keyTail but not label, so the open paint said
  "(API key ending ...)" where the switch repaint said "(b)"; a DEFAULT Gemini/Grok agent (no folder) still had no
  bracket on open but one after a switch; the arm left page state dirty.
- DECIDED (reversing review 2's rejection): fix it at the server. My reason for rejecting it was cost, "the
  live-checked lists every 5 s"; that was wrong: geminiAccounts.list() and grokAccounts.list() read folders only,
  no network. /api/status now hands accountForAgent the Gemini and Grok lists too, so their agents' rows carry
  keyTail and the slug, default accounts included (accountForAgent's provider gate keeps a dir-less default to the
  runner's own provider). The client join, the accountsRead hook and the data marks are gone; the page change is
  the rung alone. OpenAI's list is left out on purpose (codex agents keep their account shape).
- Tests: server.test.js '#5150: /api/status ...' (named Gemini row by folder with slug and key; default Grok row;
  CONTROL a Claude agent gets no keyed row); its mutant (the two lists dropped) fails with keyTail null. Arm 12:
  default Grok reads its key, named Gemini reads its slug (control), state restored by reopening the prior agent.
Weakest premise: that adding rows to `known` changes nothing for Claude agents: accountForAgent's dir-less arm
skips keyed rows for a Claude runner (isKeyedRow), and a folder belongs to one provider.

## Review 5 (Sonnet), 6 (Opus), 7 (Sonnet)
- R5: the Claude control could not fail (no launch file) -> real dir-less Claude plist and a stubbed Claude default.
  OpenAI's switch-vs-open difference stated in a comment (OpenAI left out of /api/status on purpose).
- R6: on one panel 'Right now' said '(b)' and the Move dropdown 'API key ending 9999' -> key BEFORE the slug
  (name > email > key > label), as acctPrimaryName and whoami. The previous commit message overstated the Claude
  control; corrected in the next commit's message.
- R7: stale order comments fixed. The gate is now exercised directly: a dir-less codex agent beside Claude, Gemini
  and Grok defaults must get null; removing the gate fails the test (the Grok agent takes the Claude default).
  R7's third WARNING (a default-door agent's Move dropdown changes) is NOT an issue: acctMoveWorld already falls
  back to the movable default row when a.account is null, so currentDir, currentRow and acctLive are the same as
  before, and onDefaultDoor needs !acctLive too; a default door with no key row still gets no server row.

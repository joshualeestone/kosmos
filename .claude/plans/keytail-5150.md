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

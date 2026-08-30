# codexhome-1488: the switch picker offers rows the engine will always refuse

## The defect

With `AGENT_WORKFORCE_CODEX_HOME` set, `engine/create.js` collapses the OpenAI accounts to
that one home and refuses every other. `fillSwitchAccounts` built its menu from the
unfiltered list, so every row but one was an offer the engine could only refuse. The page
states that rule itself, four lines above the filter: an option that always fails is worse
than an option that is not there.

## The approach, and why it touches four files rather than two

The rule the route needs is the engine's override check. **Restating it in `server.js` would
create a second copy of one fact, which is the engine/page disagreement this card IS.** The
codebase already carries that lesson at `openaiaccounts.js:42`: "ONE derivation, in
codexupdate, CALLED rather than restated (#1337)."

So the predicate gets one home and both callers call it:

- `engine/codexupdate.js` - `homeIsNamed()`, beside `defaultHome()` which it belongs with
- `engine/create.js` - calls it instead of restating it inline
- `server.js` - `/api/accounts` carries `offerable` on openai rows
- `web/index.html` - `fillSwitchAccounts` filters on it

## Decisions

**`offerable !== false`, not `=== true`.** A row from a server that does not send the field
stays offerable, which is today's behaviour. `=== true` would empty the menu against any
older server, turning a narrow fix into a dead control.

**No fallback guard needed at this site, and that is why it is the right site.** The picker
already hides itself on an empty list, so a named home with no identity falls through to the
engine's refusal, which names the SETTING rather than a menu row. A dropdown cannot say that.

## What was verified

The shared predicate is behaviourally identical to the inline check: 227 tests across the
nine files that pin `AGENT_WORKFORCE_CODEX_HOME` pass, and the control fires - inverting
`homeIsNamed()` reds 2 of them, so they genuinely exercise it.

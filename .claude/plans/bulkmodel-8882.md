# kosmos#8882: Settings bulk move warns when a target's model limit is full

## Finished looks like
1. In Settings, Accounts, each bulk-move target where a moved agent's own model limit is at 70% or more (the mover's target rule) is marked "(N% used, a model limit is full)".
2. Once picked, a line below the menu names who would stop and why ("Its Fable limit is at 100% of the week, so Lyra would stop there."), and agents whose model Kosmos cannot tell ("... may stop there too").
3. The person can still move them (their call: the limit may reset in an hour).
4. Same model match as the mover (acctModelKey mirrors engine/autobalance.js modelKey).

## Calls
- Warn, not hide (the card's weakest premise).
- Text only through esc() and textContent; the warning lives in a data attribute on each option and in an aria-live line.

## Evidence
- render-account-usage-6108 browser check: four new cases (a full Fable limit names only the Fable agent; a model id matches; an unknown model is said; controls: another model, room, past reset, none). PASS in chromium and webkit at both widths, run from the frozen head 646d69cf7e.

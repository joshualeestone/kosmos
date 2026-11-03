# nocharge-7827: the last paths that could say "nothing was charged" after a payment

Card: kosmos#7827 items 6 and 7, and review 8's NITs. Owner: Baron Draxum.

## What
- Item 7: engine checkout reads the HTTP status from either kind of tunnel (statusOf: the refusal object, or an older
  tunnel's line "(HTTP 409 on /path)"), so any 409 is the conflict, never "nothing was charged". codeOf also reads an
  older tunnel's "(HTTP 409 on /path, code name)".
- Item 6, board half: backup_checkout_unclosed (the relay's checkout could neither close nor read the earlier page, a
  503) gets its own sentence and starts the "if you paid" watch. The relay half names that 503 (kosmos-relay PR).
- NITs: CHECKOUT_SAY / PLANS_SAY indexed with Object.hasOwn (a wire code like 'constructor' is not a sentence); the page
  no longer keeps its own copy of the conflict sentence (the engine always sends it).

## Weakest premise
That every tunnel line names the status as "(HTTP nnn on ...)". The engine's tests and the tunnel's own (coordinator.rs)
use that form; a tunnel that printed neither the object nor that line would still fall to CHECKOUT_RETRY.

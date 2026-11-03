# planscache-7827: the plan screen's follow-ups

Card: kosmos#7827 (follow-up to the #7404 plan screen, its review round 8). Owner: Baron Draxum.
Was stacked on planscreen-7404; rebased onto main after it merged (c0b8a273fb).

## What
1. The server's shared plans read keeps only an `ok` or `final` answer for 30 seconds; a failure lets the next caller ask.
2. A plans read that throws is not kept either (the shared promise is awaited in a try, and cleared).
3. Engine test: a status naming another org never reaches the preview route.
4. Not built: one shared checkout across tabs. Ice Cream Kitty (m2563): the relay already allows one open page per
   account, and a double payment is refused in the grant and refunded by hand. A nicety, not a money fix.
5. The relay's two checkout conflicts get codes (relay PR: backup_checkout_opening, backup_checkout_finished); the board
   maps each to its own sentence, and a codeless 409 from a relay without them gets a sentence true of both. After
   "finished" (or the codeless conflict) the page watches for the plan each minute for half an hour, as after Choose.

## Transitional, remove later
A codeless 409 also starts the half-hour watch, though from a relay without the codes it may mean "opening" (no payment
pending): at most 30 extra plans reads. Once the relay with backup_checkout_opening/finished is deployed (Ice Cream
Kitty, #3763), drop backup_checkout_conflict from the watch.

## Weakest premise
That Stripe refuses to expire a page just paid (Kitty's read-back relies on it). Not measured live: no plan sold yet.

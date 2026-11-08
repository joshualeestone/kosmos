# toldat-8259: record when the person was told about a hold waiting on them, and prompt the holder when they answer

Card: joshualeestone/kosmos#8259. Decision comment: https://github.com/joshualeestone/kosmos/issues/8259#issuecomment-6725999122

## What

A for-you hold (`kosmos task hold <p> <n> --for-you`, kosmos#7788) recorded when it was set, never whether the person
was told, and nothing prompted the holder to take it off hold when the person answered.

1. Told-at, apart from set-at: `onHoldToldAt` (first ask), `onHoldLastToldAt` (latest), `onHoldToldVia` (task | room |
   reply, where it last asked), `onHoldToldId`. A tell is a holder of an open part writing about the task where the person
   reads it: the task's own conversation; a room post naming it (#N, task N); a direct reply saying "task N" when exactly
   one of that agent's for-you holds has the number.
2. Answered: the person in the task's conversation, or naming the task, every time; otherwise directly or in the room
   once per tell (an answer counts while none is newer than the latest tell). The holder's typed line gets one `[kosmos]`
   sentence naming `kosmos task unhold <p> <n>` (at most three holds named, the rest counted); never on a line kept to be
   typed later. `onHoldAnsweredAt` is marked once the line carrying it was typed (a DM placed; in the room, every holder
   placed or unconfirmed; the task conversation always, since the words are on the task).
3. The five fields go wherever the for-you mark goes (tasks.HOLD_TOLD_FIELDS): hold off, mark off, newly marked, task
   closed, or a changed reason (a new question). A changed condition keeps them.
4. Shown: the Tasks row (It asked you N ago / Kosmos has not seen it ask you about this yet / You answered ...), the
   agent's `kosmos task show`, and the holder's instructions (name the task when you ask).

## Not done, decided

- Read-time derivation from the three logs (no write, but the room log is read whole on every Tasks load).
- Kosmos posting the ask itself when the hold is set (makes told-at equal set-at, and speaks for the agent).
- A direct message that names no task is not a tell. Weakest premise: agents name the task when they ask. The
  instructions and task show now say to.
- The project page's task card (tkcard-for-you) shows the reason only, unchanged: the Tasks row is where the person acts.

## Proof

- engine/holdtold-8259.test.js, engine/messages.holdtold-8259.test.js, server.holdtold-8259.test.js, and two assertions
  in docs/browser-checks/render-onhold-4771.js (light and dark, passed at 5468c7dae1).
- Mutation arms: 16 before review (15 red; the 16th removed one of two copies of the then first-tell guard, red with both
  removed), then 12 for the review fixes, all red.
- Review: four blind rounds, opus / sonnet / opus / sonnet; the last found no BLOCKER or WARNING. Each round's findings
  and what was done are in that round's commit message.

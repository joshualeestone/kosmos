# musewhoami-5636: F5 from the 0.7.33 report (kosmos#5636)

## Done looks like
A Meta Muse agent whose model Kosmos has not read gets a whoami sentence that is true on every path and gives one step
that cannot loop.

## Why #5657 did not fully take
0.7.33 names the provider (that part landed); the model comes only from the file the Muse helper keeps once a turn
names the model, read on the board's pass. Why it is missing on Josh's seat was not measurable from here: a helper
started before keeping existed, no turn yet, a refused model name, a stream that never names it, or the Muse marker
not recorded (then the board never reads the file). Each gives the same blank.

## Decided
- Say only what is known: none read yet, normally read once a turn names it; if it persists after a later turn, tell
  the person once that Kosmos cannot read this agent's model.
- No restart advice (review 4): a restart clears the kept model until the next turn, and most causes are not helped
  by one, so it could only send the person round in a loop.
- Weakest premise: this explains the blank but does not fill it. Filling it needs the seat's own evidence (the next
  multi-model run): whether `.kosmos/muse-model` exists in the agent's folder after a turn.

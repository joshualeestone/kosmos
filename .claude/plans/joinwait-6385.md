# joinwait-6385: a joining computer says why it waits (kosmos#6385)

## The call
The card's own fix shape: a plain line on the joining computer after a minute with no code, and no protocol change.
- The computer that allows answers one new computer at a time, about one every 10 minutes (kosmos-relay
  `crates/tunnel/src/pairing.rs`: `ANSWER_EVERY_SECS = REVEAL_TIMEOUT_SECS = 600`), and `JoinStatus` carries no
  wait reason, so the joiner cannot know it is waiting its turn.
- After `PLUS_JOIN_SLOW_MS` (60 s) of a wait with no code, `paintPlusJoin` adds: "Your other computer adds one
  computer at a time, about one every 10 minutes, so if you are adding more than one, this one may be waiting its
  turn. Keep this open: the code shows here."
- It shows in both waits the card names: "Working out the code with ..." and, after Try again, "That code ran out.
  A new one is on its way."
- `PLUS_JOIN_NOCODE_AT` records when the wait began; any other state (a code, a failure, Try again owed, a ran-out
  ending, no pairing, Forget or Off) clears it, so each wait has its own minute.

## Design
- One grey hint line (`fhint`, the block's own hint style, not the bold `plus-join-next` action line) inside the
  existing join block; nothing moves. The browser check asserts its words, its class and its weight. The copy is for
  review on the PR. The minutes are built from `PLUS_JOIN_CODE_MS` (the tunnel's REVEAL_TIMEOUT_SECS, which its
  answer pace equals), so the page has one source for the 10 minutes.
- The minute is this page's view of the wait: a reload partway through starts a new minute.

## Rejected
- Carrying the real reason (computer 1's `code_wait`) to the joiner: a protocol change across the tunnel and the
  coordinator, for a card whose fix shape says the plain line is enough.
- A countdown or an ETA: the joiner does not know its place in the queue (inbox order decides it), so any number
  would be a guess dressed as a measurement.

## Weakest premise
- The line names the likely reason, not the known one: the other computer may simply be off or asleep. The words say
  "may be waiting its turn" for that reason, and that the code shows here either way.
- "About one every 10 minutes" is the tunnel's constant today; if it changes, this sentence must change with it.
  What would change my mind: a measured wait on two real computers that does not match 600 s.

## Checks
- `web.joinwait-6385.test.js` (6 tests, one that no rig leaks state onto the global object): the real paintPlusJoin and helpers, lifted from the page, with a clock the
  test moves. The line is absent before a minute and present after, in both waits; it goes when a code shows and the
  next wait starts its own minute; a pairing that ends clears it. Mutants: no line reds 3; no reset on a code reds 1;
  no reset when the pairing ends reds 1.
- `docs/browser-checks/render-connect-sheet-4637.js`: a new arm sets the wait's start back 61 s, repaints, and asserts
  the line (words, fhint, not bold), and that it goes once the wait restarts.

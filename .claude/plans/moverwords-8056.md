# moverwords-8056: Settings says what the account mover now does (kosmos#8056)

## Why
#8048 taught the mover to move an agent stopped at its usage limit. The page still says it moves idle agents only.

## What
1. Mona Lisa's wording on the card: the Settings hint, the planned move line, the nothing-to-move line, and a skipped line worded from the record's `because`, with a fallback for older records.
2. Beyond her list, same defect: three lines saying "the idle agents" (a login at risk, and no account able to take them, moving and not). A stopped-at-limit agent can be among them.
3. Beyond her list: the hint's "For now it only says what it would do. Nothing is moved." is false on an armed board, and both fleet boards were armed on 11-05. Hidden when `ab.moving === true`.
4. Card item 2: `movableFor` passes the assigner it was given to `stoppedAtLimit`.
5. Card item 4: each promise in the move message is cut at 120 code points, after the @ filter.

## Decided, not done
- Card item 3 (no report hook, a recovered pane still showing a limit line): left. It needs an at-risk account, a target and two sightings, and closing it needs a signal such an agent does not send.
- Card item 5 ("was running out" for an agent at the wall): left. The clause is about the account, which is at the measured limit it names, and the next sentence says the agent had stopped.

## Weakest premise
That 120 characters is enough of a promise to be useful. It is a guess, and one constant.

## Tests
engine/automove-7548.test.js (two new, three mutations each red), docs/browser-checks/render-autobalance-7152.js.

# longpaste-8333: a box read as holding other text is looked at again before it is believed (kosmos#8333)

## Problem
A 9,980-character message to an idle agent ended with "held other text too, so Enter was not pressed", while the box held only that message. One Enter delivered it.

## Measured
The card's likely cause (a shortened paste) did not reproduce. A real Claude Code at 80x24, 2.1.321 and 2.1.316 (the pane ran 2.1.314, no longer on disk), with Kosmos's own paste shape and read and the exact message, showed plain words and read as "ours" at 200 ms, 800 ms and 2 s, three runs each. Not measured: the board's real wire, a real Opus pane under load, the box right after `/model`.

## Change
No change to what is pressed. When the box reads "other" and is not pressed, up to 10 more looks 60 ms apart are taken for the log only, and the board log gets one masked line: the wire's and box's lengths, the box's shape, and what the box read after those looks. That tells the next occurrence apart: a passing misread, a steady one, or a chip form the rules do not know.

## Decided
- The first version let a later "ours" read press the Enter. Review 2 showed that widens the danger: a long box shows only its last rows, so 600 ms lets a person's own words scroll out of view and the read then says "ours". For a cause that did not reproduce, that is the wrong trade. Nothing presses after a read of "other".
- The line is a permanent delivery warning, with its mask in `notPressedLine` and tested. Rejected: a removable debug line, because the event is rare and the next one is what we are waiting for.

## Weakest premise
That the log line will show enough. It says the shape and the later reading, not the words.

## Not done
The card's done-when is not met. It stays open until the next occurrence shows the cause. Until then a false "other" still leaves a message unsent, as today.

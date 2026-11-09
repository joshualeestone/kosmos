# longpaste-8333: a box read as holding other text is looked at again before it is believed (kosmos#8333)

## Problem
A 9,980-character message to an idle agent ended with "held other text too, so Enter was not pressed", while the box held only that message. One Enter delivered it.

## Measured
The card's likely cause (a shortened paste) did not reproduce. A real Claude Code at 80x24, 2.1.321 and 2.1.316 (the pane ran 2.1.314, no longer on disk), with Kosmos's own paste shape and read and the exact message, showed plain words and read as "ours" at 200 ms, 800 ms and 2 s, three runs each. Not measured: the board's real wire, a real Opus pane under load, the box right after `/model`.

## Change
Right before the Enter, a box that reads "other" gets up to 10 looks 60 ms apart. A read of "ours" goes on to the Enter, after the window is re-verified, as the fold path does. Still "other": not pressed, as today, and the board log gets the box's shape with letters and digits masked.

## Decided
- Only a read that says "ours" ever presses. A box that really holds other text is unchanged, so arm two holds by construction and is pinned by a test.
- Rejected: pressing Enter on a long paste regardless (would send a person's typing). Rejected: raising the chip rules (no chip was seen).

## Weakest premise
That the false "other" was transient. If it was steady, this changes nothing for the person, and the log line is what finds the real cause on the next occurrence.

## Not done
Arm one is not reproduced, so the card's done-when is not met by this alone.

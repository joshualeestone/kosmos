# dmspacing-8282: agent chat at 18px per line (kosmos#8282)

Josh, 2026-11-09 07:20 (relayed by Splinter): go with the recommendation; 18 from the 11-07 picture.

## Done when
Served on PROD, an agent conversation on the computer measures 18px per line (13px type) in Chromium and WebKit, and the project room stays at 1.6.

## Change
`#d-dmthread .msg-bd` gains `line-height: 18px`. The check that already measures the room now asserts this too.

## Not this
The room; a message from outside Kosmos in a shared project (`.msg-ext-tx`, still 13/16); the iPhone (system spacing).

## Weakest premise
That "chat line spacing" means the computer's agent conversation, which is what the picture showed. The iPhone was not in the picture.

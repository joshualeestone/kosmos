# scrollrest-7609: the sample scroll-up rests when the end has gone, not on a clock

Card: kosmos#7609 (UI tests in CI). One of main's red ui-tests runs (41700157014) failed
KeyboardSlideUITests.testReadHigherUpStaysWhereItWas because the Debug hook KOSMOS_SAMPLE_SCROLLUP declared the scroll
"rested" 0.6 s after starting it ("debug scroll-up rested, atBottom true"): on a slow runner the end marker still showed,
so atBottom stayed true and the chat later went to the newest on the keyboard, as it should for a reader at the newest.
The test then measured a reader who was never higher up.

## What finished looks like
The hook marks the rest only once the end marker has left the screen (or after 5 s, recording atBottom as it is), and a
source check pins it. Debug only: Release never compiles the hook.

## Change
ios/Kosmos/ChatView.swift: `sampleScrollRest(tries:)` (DEBUG) looks every 0.2 s, at most 25 times, from 3.6 s after
opening; the rest sets atBottom from endVisible and shows the marker, as before. RoomView's hook sets no atBottom and is
unchanged.

## Decided
- Poll for the end, rejected a longer fixed delay (still a clock, and slower on every run).
- Weakest premise: that endVisible going false is the scroll having landed. It is the condition the rest already reads.

## Tests
room/main.swift pins the poll. Typecheck Release and DEBUG; room suite passes. The behaviour is CI's ui tests job.

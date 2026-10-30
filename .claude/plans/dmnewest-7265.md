# dmnewest-7265: a UI test that a long DM opens on its newest message (kosmos#7265)

Josh, 10-26: a long DM opened somewhere in the middle. The fix shipped in TestFlight build 8; the card waited on a phone.
Its done-line ("a DM with 200+ messages opens on its newest message") involves no hardware, so a simulator answers it.

## Finished looks like
- ChatOpensAtNewestUITests (opt-in, TEST_RUNNER_KOSMOS_UI_PLUS=1) opens Dana's long sample chat
  (KOSMOS_SAMPLE_LONG=varied: 220 messages of varied length, 40 older) and passes only if "Message 260 of 260." is
  wholly on screen between the top bar and the composer, on the first open and again after Back and reopening Dana.
- A control in the same test: "Message 250 of 260." is not on screen, so the check tells the end from the middle.
- Measured 10-30 02:36 CDT on a fresh iPhone 17 Pro simulator, iOS 27, main aa0c68b54a: PASS, screenshots of both opens.

## Decided
- A test only; no app change. Rejected: a logic test of the scroll target, which cannot see where the list rests.
- Weakest premise: the 1.5 s settle before reading frames; a slower settle would read as a failure, never a false pass.

## Not in scope
- Staying at the newest message while messages arrive: needs a live board (#7420).

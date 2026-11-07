# ahlog-8021: say in the board log what each auto-handoff prompt's delivery did

Card: kosmos#8021. Renet measured (11-07, served 0.7.96) a real seat's 85% handoff prompt left unsent in its box;
the stuck-input sweep left it there as "too long to read whole", and nothing recorded what the delivery had said.

## Change
- engine/chat.js: confirmedVerdict records `confirm` (what the check after the Enter read); deliver's never-pressed
  return records confirm: 'not-pressed'. Additive. confirmedVerdict is exported for the test.
- engine/autohandoff-sweep.js: each prompted entry also carries unsubmitted, remembered (an unsentSeq), confirm,
  heldByInput, heldBy and because. promptLogLine(p) says, from those, what the delivery read (see the test for every
  wording), whether the line was kept as a numbered unsent line, and whether it is asked again.
- server.js: the sweep's result is kept and each prompted entry's line written to the board log (stdout).
- No behaviour change: the band still advances only on PLACED; nothing is pressed or sent differently.

## Why this, and not a rescue change
The stuck-input rescue presses a long box only when it still remembers the line as the board's own. Pressing long
text it did not remember would risk sending a person's words; its "not ours" rule is deliberate. What is missing is
the evidence of which path the prompt took. This line gives it at the next occurrence.

## Measured
- engine/autohandoff-log-8021.test.js plus the existing autohandoff tests pass; 759 chat and delivery tests pass.
- Perturbations: the server not writing the line, and `remembered` always false, each turn the new tests red.

## Weakest premise
That `confirm` is set on every path the auto-handoff delivery can take. A path that returns a verdict without it
falls back to the state words, which do not separate sent from unread.

## Review round 1 (decided)
- BLOCKER, fixed: "read as sent" and "could not read the box after the Enter" both came back as the same PLACED
  verdict, so the first version logged both as "sent", which is the very question the card asks. chat.js
  confirmedVerdict now records `confirm` (sent / unread / unsent / other), and deliver's never-pressed return records
  confirm: 'not-pressed'. Additive fields only; 759 chat and delivery tests pass unchanged.
- The line's words come from those markers: an Enter that did not take, one pressed into other text, one never
  pressed, a box already holding unsent text (COULD_NOT held by input), each said as such. The "not kept" clause is
  gone (it described this attempt, not the box). The retry clause says "while it stays over the threshold".
- Tests build the verdicts with chat.js's confirmedVerdict (exported for that) or copy its return shapes; the wiring
  check ignores comments. Perturbed: without `confirm` the sent/unread test is red.
- Known and accepted: while a box stays held the sweep re-delivers every minute, so one line per agent per minute
  until it clears. That is the evidence wanted; quieting it is a later choice.

## Review round 2 (decided)
- Words no stronger than the evidence: "sent" is "its box no longer held the prompt" (a sent outcome also covers
  a box where someone started typing); "not sent" became "left in its box" or "not confirmed" (UNCONFIRMED means may
  be there). A could-not names its hold (menu, account, quota) and its because.
- The untested branches are tested now; the JSDoc lists the new fields.

## Review round 3 (decided)
- Only NITs. Two taken, because this line exists for diagnosis under load: an unsent outcome says what was seen
  ("it still held the prompt when checked after the Enter"), not why, since a slow submit and a swallowed Enter read
  the same; chat.js's own hold reasons start "held: ", so the line says the reason once. Left: two collected fields
  promptLogLine does not need (unsubmitted, heldByInput beside heldBy), and the retry wording's rare band case.

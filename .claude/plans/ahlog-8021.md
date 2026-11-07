# ahlog-8021: say in the board log what each auto-handoff prompt's delivery did

Card: kosmos#8021. Renet measured (11-07, served 0.7.96) a real seat's 85% handoff prompt left unsent in its box;
the stuck-input sweep left it there as "too long to read whole", and nothing recorded what the delivery had said.

## Change
- engine/autohandoff-sweep.js: each prompted entry also carries `unsubmitted` (the verdict's unsubmitted: true, its
  Enter did not take) and `remembered` (the verdict carries an unsentSeq: chat kept it as a numbered unsent line,
  which the stuck-input sweep can press later). New promptLogLine(p): one line, "autohandoff: <session> at N%:
  handoff prompt <sent | not confirmed as sent | could not be typed>[, its Enter did not take][, kept as a numbered
  unsent line, to be pressed later | , not kept as a numbered unsent line][, will be asked again next sweep]".
- server.js: the sweep's result is kept and each prompted entry's line written to the board log (stdout).
- No behaviour change: the band still advances only on PLACED; nothing is pressed or sent differently.

## Why this, and not a rescue change
The stuck-input rescue presses a long box only when it still remembers the line as the board's own. Pressing long
text it did not remember would risk sending a person's words; its "not ours" rule is deliberate. What is missing is
the evidence of which path the prompt took. This line gives it at the next occurrence.

## Measured
- engine/autohandoff-log-8021.test.js (3 tests) plus the existing autohandoff tests: 27 pass.
- Perturbations: the server not writing the line, and `remembered` always false, each turn the new tests red.

## Weakest premise
That the verdict's unsentSeq is the right signal for "kept": a line kept only lightly (an unread box after the
Enter) has no number, and the line says only "not kept as a numbered unsent line", which is true but not the
whole story for that case.

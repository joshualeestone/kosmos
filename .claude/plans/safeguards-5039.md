# safeguards-5039: the safeguards model-switch menu says what it asks (kosmos#5039, detection half)

Started 2026-10-02 12:55 CDT, Ice Cream Kitty. The settings default (pre-set switchModelsOnFlag, Josh 11:14) is Renet's (#5042); this is
the board-reading half only.

## Measured first (posted on the card)
On main b56e37c30, Splinter's 11:07 capture of Angel's pane already classifies needs_you (generic drawn-menu detection), and stays
needs_you under a fresh `working` or `idle` self-report. The card's "board shows idle/working" did not hold for the board; the fleet's
builder check is a different reader. What was missing: the reason was the generic "it is asking you something", with no evidence, so
the person could not tell a model choice from a permission prompt.

## Change
engine/status.js safeguardsMenu(tail), called only inside the drawn-menu branch: rows "1. Switch automatically" then, within 3 rows,
"2. Stay on <model>" -> because "Claude Code's safeguards stopped it on <model>, and it is asking whether to switch models automatically
or stay on <model>", evidence "1. Switch automatically / 2. Stay on <model>". Anything else keeps ASKING_GENERIC.

## Decided, and why
- Keyed on the two option rows (seen live AND in the 2.1.287 binary), not the sentence, which varies ("this session" live, "this
  message" in the binary).
- Requires "Stay on": the binary also draws "1. Switch automatically / 2. Ask each time" (a settings choice); that stays generic.
- Kosmos never presses the menu; the choice is the person's.

## Weakest premise
The capture had blank and border rows stripped; the test puts them back where Claude Code draws them. The option rows are verbatim.

## Validation
- #5039 test: needs_you with the retry row under it, specific reason naming the model, evidence naming the choice, no em dash;
  controls: an ordinary menu keeps the generic reason, the settings menu keeps it, the words in prose are not the modal.
- Fails on main at "the board still says only that it is asking, not what". Mutants: no call -> that arm; no "Stay on" check -> the
  settings-menu control. status.test.js + status.pane-states-1889.test.js: 239/239 (+ the new test).

## Review
- Round 1: PENDING.

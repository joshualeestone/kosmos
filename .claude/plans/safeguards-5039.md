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
- Requires "Stay on": the binary also has "Switch automatically" / "Ask each time" as a /config enum (how it is drawn is ASSUMED, not seen); that shape stays generic.
- Kosmos never presses the menu; the choice is the person's.

## Weakest premise
The capture had blank and border rows stripped; the test puts them back where Claude Code draws them. The option rows are verbatim.

## Validation
- #5039 test: needs_you with the retry row under it, specific reason naming the model, evidence naming the choice, no em dash;
  controls: an ordinary menu keeps the generic reason, the settings menu keeps it, the words in prose are not the modal.
- Fails on main at "the board still says only that it is asking, not what". Mutants: no call -> that arm; no "Stay on" check -> the
  settings-menu control. status.test.js + status.pane-states-1889.test.js: 239/239, the new test included.

## Review
- Round 1 (opus, blind): 0 BLOCKER, 3 SHOULD-FIX. SF1 taken: the menu was found anywhere in the tail, so the modal's rows in prose (or an
  old answered menu) above a LIVE permission prompt named that prompt the safeguards menu; now "1. Switch automatically" must be the last
  "1." row (the live menu); ABOVE control. SF2 taken deliberately: with evidence, a live safeguards menu leads over an agent's own standing
  needs_you report (reported:false, red card, not the calmer question style), because the agent is stopped on the menu, not on its
  question; pinned. SF3 scoped out: the reason reaches a person only on the detail page (stateReason returns '' for a scraped needs_you
  everywhere), and that page also says it cannot find the question (chat.questionIn is null on the capture, pre-existing); filed #5051.
  NITs taken: "<model>'s safeguards" (the vendor's words); evidence must name the model (M6); plan wording. NIT not taken: the evidence is
  two verbatim screen rows joined with " / ", shown under "screen said:"; both rows are on the screen.
  Measured 13:23, each red by name: no last-"1." check -> ABOVE; evidence without the model -> evidence arm; no evidence -> evidence arm.
  239/239.
- Round 2: PENDING.

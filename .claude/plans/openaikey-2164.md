# openaikey-2164: format the add-a-provider OpenAI key step like the Claude callout

Card: joshualeestone/kosmos#2164. Design/content lane (Mona Lisa).

Josh, 2026-09-04 (#admin, screenshot 4.03.46): "the API key for ChatGPT should look
exactly like the Claude Connect as far as having the nice checkbox and formatted
text. Right now it's just gray text that is not formatted in any way."

## What finished looks like

On the Add a provider modal, the OpenAI key explanation reads as a formatted
callout in the same visual language as the Claude connect callout beside it:
full ink (not muted grey), a marker glyph, and a bold lead. A person switching
between the two providers sees one consistent treatment, not one polished screen
and one plain-grey one.

## Findings (rendered both screens headless, not assumed)

- The reference is the ADD-ACCOUNT Claude flow's callout `#acct-claude-warn`
  (class `.dwarn`): a red triangle marker (`.dwarn-m`) + bold lead + full-ink
  callout font. The OpenAI key step right beside it (`#acct-openai-key-step`)
  used plain `.dhint` (muted grey, no marker, no bold) -- exactly the "just gray
  text" Josh flagged.
- "the nice checkbox" is that marker glyph. There is NO literal checkbox on any
  Claude connect screen (confirmed by reading the code and rendering it); Josh's
  word describes the marked-callout affordance.
- The first-run OpenAI flow (`#fr-openai-flow`) already uses formatted
  `.fr-confirm` styling, so it is not the gray screen and is out of scope.

## The change

1. `web/index.html`: the `#acct-openai-key-step` explanation goes from `.dhint`
   to the `.dwarn` callout, with a bold lead ("Paste an OpenAI API key.") and a
   marker span, matching the Claude callout's structure.
2. The marker is a NEUTRAL ink checkmark (`.dwarn-ok`, new), deliberately NOT the
   Claude flow's red (this text reassures, it does not warn) and NOT the file's
   connected-green (`.acct-ok`, which is the "connected" vocabulary a not-yet-
   connected key step must not borrow -- "one vocabulary for one outcome").
3. `web.firstrun-model.test.js`: re-anchor the "exactly one Settings key warning"
   count on the reassurance clause, since the lead is now a `<b>` element and the
   old contiguous regex would match zero.

## Verification

Committed browser-check `render-openai-key-callout-2164.js` (read-only, wired
into `browser-checks.sh`, indexed): forces the modal visible and asserts the
OpenAI callout is `.dwarn` with a marker and a bold lead, its computed text
colour MATCHES the Claude callout (full ink) and DIFFERS from the still-present
`.dhint` grey on the same screen (the control), with the Claude callout as a
positive control for the structure. Proven red on origin/main (OpenAI is `.dhint`
there), green with the fix.

## Weakest premise / reversible

Josh said "look exactly like" the Claude callout, which uses a red warning
marker. A red danger triangle on reassurance text ("your key stays on this
computer, never shown again") would mis-signal, so I chose a neutral checkmark
instead of copying the red. If Josh wants the exact red marker, or a different
glyph/colour, it is a one-line change. Also left the secondary "The name is
optional" hint as muted `.dhint`, since it is an appropriate hint for an optional
field and not the text Josh flagged.

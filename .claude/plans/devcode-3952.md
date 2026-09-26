# devcode-3952: device sign-in codes big, in boxes, on their own row (kosmos#3952)

Josh, 2026-09-26 08:06: "it would be great on this screen if we showed the code on a separate row and displayed it in a
similar graphical fashion so that it visually matches ... Oh crap, I have to enter this in terminal".

## What changes (web/index.html)
- `devCodeHtml(lead, code, note)`: one box per character, grouped at the provider's dashes (xAI 4-4), on its own row
  under the lead line. Display only. The characters are real text (Copy and hand-selection get exactly the code); a
  screen reader gets the code once, in groups, from the row's label.
- Grok (Settings and first run, one shared driver): the boxes plus "xAI's page says "terminal": it means this code
  here in Kosmos."
- OpenAI device code: Settings and first run painters, and the Windows device markup (boxes inside the .fr-cmd the
  Copy button reads, so Copy is unchanged).
- Connections (GitHub, Vercel and the other device doors): the same boxes instead of large plain text.
- The "Open the sign-in page" button and "Stop this sign-in" are untouched.

## Decided
- INLINE-BLOCK cells, not flex: measured, flex items made the row's own text one character per line, so a person
  copying the code by hand got newlines, and the GitHub door check (innerText) would have gone red.
- Page colours, not the Kosmos+ page's dark palette: #3942's boxes are scoped to that page; these match its shape.
- The "terminal" line only on xAI's flow (only xAI's page says it).

## Review round 1 (Opus), what changed
- BLOCKER, my own false claim: "measured at 360px" measured a full-width test paragraph, not the real boxes (first
  run's Grok box is 222px). The boxes now size to their own container (cqw, the #3942 approach, vw fallback), each
  group is one piece, and the row breaks after the dash: 4 over 4 on a phone. 360px arms added to both checks; they
  go RED on the previous commit's page (the defect the reviewer measured) and green now.
- BLOCKER: on Windows the boxes sat in the Copy row's scrolling cell (3 of 9 showed). They now sit on their own row
  above it; the cell keeps the code as text, hidden to the eye, so Copy is unchanged.
- WARNING: the Kosmos+ device approval card (#3829) was missed, my search was wrong. Its code is now in the same boxes,
  on its own row under the device and time (it was large at the right; Mona's #3829 layout, told).
- WARNING: the GitHub door check asserts the boxes, not only the text.
- NITs: letter-spacing reset on .devcode itself; the tinted strip is gone with the host class.
- Deferred NIT: role="img" makes VoiceOver add "image" after the code. A hidden-text alternative would be copied
  along with the code by a hand selection, so the label stays.

## Weakest premise
- A provider whose code has no dash is one group, which cannot break: 10cqw fits five characters in its box, so a
  longer undashed code shrinks rather than wraps. Every code seen so far has a dash (xAI 4-4, OpenAI 4-5, GitHub 4-4).

## Tests
- render-grok-subscription-3391.js: Settings and first run show 8 boxes, one dash, the right text, one row, readable
  size, the note, the spoken label, and hand-copy text "QWER-TYUI" (perturbed red: old sentence, no note, small boxes).
- render-openai-devicecode-3436.js: boxes spell the code with OpenAI's grouping, no xAI note (perturbed red: old markup).
- web.openai-devicecode-3436.test.js: the Copy cell's text is exactly the code, one box per character.

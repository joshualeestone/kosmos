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
- Kosmos+ device approval: no device code is drawn by this page for it (searched); nothing to change here.

## Weakest premise
- A provider whose code has no dash is one group: fine for 8 or fewer characters; a long one would still fit (nowrap,
  measured at 360px for 9 characters) but would not match a provider page that groups differently.

## Tests
- render-grok-subscription-3391.js: Settings and first run show 8 boxes, one dash, the right text, one row, readable
  size, the note, the spoken label, and hand-copy text "QWER-TYUI" (perturbed red: old sentence, no note, small boxes).
- render-openai-devicecode-3436.js: boxes spell the code with OpenAI's grouping, no xAI note (perturbed red: old markup).
- web.openai-devicecode-3436.test.js: the Copy cell's text is exactly the code, one box per character.

# tokenless-4602: say a token is missing when none was sent (#4580 item 13)

Card: joshualeestone/kosmos#4602 (the Meta agent's finding in Josh's Five Families project).

## Done
- server.js `boardTokenRefusal(req, tail)`, used by the board-token gate and POST /api/team's operator path. With no
  credential presented (no board token by cookie, header or query; no agent token header) and not from a browser:
  "no board token or agent token came with this request, so it was refused (<the account sentence>). Kosmos's own
  commands send one for you: use `kosmos ...` rather than calling the board directly".
- A token that was sent and does not match, and every browser request, keep the account sentence word for word.

## Decided
- The account clause stays inside the new sentence: it is still true, and it is the phrase every test and reader
  of this refusal recognises (five test files, seven browser checks' fixtures).
- A browser keeps the old sentence: the page shows this error to a person (org-chart import, Settings), for whom
  `kosmos open` is the advice. Browser = Sec-Fetch-Site present. Not Sec-Fetch-Mode: Node's own fetch (the
  Windows CLI) sends `sec-fetch-mode: cors` by itself and no Site (measured).

## Weakest premise
That no agent calls the board through a real browser engine without a token. A Playwright-driven agent would get
the person's sentence, which is still accurate, only less specific.

## Tests
server.tokenless-refusal-4602.test.js (5): the two "missing" arms fail on main (control measured), the rest pass on both.

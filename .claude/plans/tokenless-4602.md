# tokenless-4602: say a token is missing when none was sent (#4580 item 13)

Card: joshualeestone/kosmos#4602 (the Meta agent's finding in Josh's Five Families project).

## Done
- server.js `boardTokenRefusal(req, tail)`, used by the board-token gate and POST /api/team's operator path. With no
  credential presented (no board token by cookie, header or query; no agent token header) and not from a browser:
  "no board token or agent token came in this request's headers, and <the account sentence>. A `kosmos` command
  sends the token for you when it can read this board's token file". No "refused" of its own: both CLIs print it
  inside "Kosmos refused that request: ...". "Headers" because a body agent token is read after this gate.
- A token that was sent and does not match, and every browser request, keep the account sentence word for word.

## Decided
- The account clause stays inside the new sentence: it is still true, and it is the phrase every test and reader
  of this refusal recognises (five test files, seven browser checks' fixtures).
- A browser keeps the old sentence: the page shows this error to a person (org-chart import, Settings), for whom
  `kosmos open` is the advice. Browser = Sec-Fetch-Site present. Not Sec-Fetch-Mode: Node's own fetch (the
  Windows CLI) sends `sec-fetch-mode: cors` by itself and no Site (measured).

## Out of scope (review iteration 1)
- The report, report-show and reply handlers' own no-credential refusal (`denyPaneFallback`) says "this board only
  ... from the account that started it". Same class, different code path, reached after the gate; left for a
  follow-up so this change stays the gate the Meta agent hit: filed as #4606.

- Wording is chosen from a client-sent header (Sec-Fetch-Site), so it can be spoofed; it changes words only,
  never access (review iteration 2, accepted).

## Weakest premise
That no agent calls the board through a real browser engine without a token. A Playwright-driven agent would get
the person's sentence, which is still accurate, only less specific.

## Tests
server.tokenless-refusal-4602.test.js; the "missing" arms were measured failing on main before the review rounds.

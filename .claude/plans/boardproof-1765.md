# boardproof-1765: the board proves itself before a client sends it a token

Card: kosmos#1765 (security audit pass 3). Details are private; this file states only the design.

## What changes
- `engine/boardproof.js` (new): the key id, the proof (HMAC-SHA256 over the port and a fresh nonce, keyed on the
  token), the board's answer, and a node client check (`boardHoldsToken`, one deadline for the whole exchange).
  As a program it does only the arithmetic for the CLI: `--key` and `--verify <base url>`, input on stdin.
- `server.js`: `GET /api/board-proof?n=<32 hex>&k=<16 hex>` is exempt from the token gate. It answers for the
  board token, the world tokens the gate accepts, then the agents' tokens (read only if nothing matched first),
  bound to the port the board listens on. 404 for any other key id, 400 when malformed.
- `install/kosmos`: `kosmos_board_proven` runs before `kosmos_curl` sends any token. The proof goes by curl on the
  same route (#4933) and within the caller's -m. 98 when a listener answered but could not prove it; curl's own
  code when nothing could be reached, so busy and down boards read as before. `say_unreached` names 98 plainly;
  `kosmos community comment` counts it as not sent. The Mac report hook goes through the CLI, so it is covered.

## Not covered by this PR (stated, not missed)
- Senders: the four `bin/*-report-bridge.js` (next PR on this card), the Windows senders (Homer's spec), and the
  native app (`native-app/main.swift` sends the token as a header and in `?token=` page loads).
- The board cookie holds the durable token and browsers do not scope cookies by port, so a browser opening the
  board address while something else holds the port sends it. Needs its own design (a cookie that is not the token).
- The CLI outside the installed layout (a checkout run, and the source checkout the report hook prefers when the
  bundle is stale, #2644) and an installed bundle older than this check: these send as before.
- A token-only agent (KOSMOS_AGENT_TOKEN_ONLY=1) whose world is not the one the board serves: its proof finds no
  token and it gets 98 where it used to get 421 and keep the message for later. A pilot-only setting today.
- The gap between the proof and the request (two connections): a board that stops in between and a listener that
  takes the port in that moment.

## Tests
- `server.board-proof-1765.test.js`: real board; answers for its token and an agent token, bound to its port; 404
  for another token; 400 when malformed; a squatter and a dead port read false; a POST is still refused by the
  token gate.
- `cli.board-proof-1765.test.js`: installed layout. A proven board gets the token; a squatter gets nothing and the
  CLI says so. CONTROL: the checkout layout sends the token to the same squatter.

# boardproof-1765: the board proves itself before a client sends it a token

Card: kosmos#1765 (security audit pass 3). Details are private; this file states only the design.

## What changes
- `engine/boardproof.js` (new): key id, HMAC proof, the board's answer, and the client's check
  (`boardHoldsToken`). Also runnable as `boardproof.js --check <base url>`, with the token on stdin.
- `server.js`: `GET /api/board-proof?n=<32 hex>&k=<16 hex>` is exempt from the token gate. It answers
  HMAC-SHA256(token, nonce) for the board's world tokens and its agents' tokens, or 404.
- `install/kosmos`: `kosmos_board_proven` runs before `kosmos_curl` sends any token, in the installed layout
  (runtime/bin/node and app/engine/boardproof.js present). Proven once per shell. Refusal returns 98 and sends
  nothing. The Mac report hook goes through the CLI, so it is covered too.

## Not in this PR (stated, not missed)
- The four `bin/*-report-bridge.js` senders: a follow-up PR on this card, with a shared stub helper for their
  18 stub-server tests.
- The Windows senders (engine/kosmos-report-hook.js, tools/kosmos-open-board.js, the launcher): Homer's, as a
  spec using this module.

## Tests
- `server.board-proof-1765.test.js`: real board; answers for its token and an agent token; 404 for another
  token; 400 when malformed; a squatter and a dead port both read false; a POST is still gated.
- `cli.board-proof-1765.test.js`: installed layout. A proven board gets the token; a squatter gets nothing and
  the CLI says why. CONTROL: the checkout layout sends the token to the same squatter.

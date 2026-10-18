# sendproof-6464: the shared parts of #6464 (Mac and Windows)

Card joshualeestone/kosmos#6464 (from the #6437 review). The split is on the card (Angel 03:27): this branch takes only the shared code; Homer takes the Windows CLI, the launcher, the opener.

## Finished looks like
1. engine/kosmos-report-hook.js proves before EACH send (keep, toolfail, report), not once per run. A listener that changes between sends (the board restarted, another process took the port) gets nothing.
2. The Mac CLI (install/kosmos) never sends a secret in a request body unproven. Today kosmos_board_proven returns 0 for "no token to protect", so `kosmos connect <service>` (token on stdin, sent in the body) goes unproven when board.token is missing or unreadable. Decided: when a call carries a body secret and there is no board token to prove with, REFUSE the send and say why (there is nothing to prove the listener with). Do not invent a proof.

## Steps
1. Hook: find `proven(c, ...)` at the three call sites (keep around line 494, toolfail around 505, report around 531) and the cache (`proverFor`, line 374). Make each send prove fresh. Keep the "not proven: nothing sent, exit 0" behaviour.
   Test: engine/kosmos-report-hook.board-proof-1765.test.js has real listeners. Add an arm where the listener changes between two sends in one run (a board that proves, then a squatter on the same port), and assert the second send never reaches the squatter. Add a control where both are the board.
2. Mac CLI: find verbConnect's body send and kosmos_board_proven. If there is no board token and the call carries a body secret, refuse with exit 98-style "not sent" and a plain sentence. Test with a cli.*.test.js arm and a control.
3. Run: the touched tests, browser-checks-selectors, web.click-bindings, and the full web.*.test.js sweep (index.html is not touched, so likely skip). Then challenge loop, proof, PR, watcher.

## Review log

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

### Round 1 (opus, 05:03): no blockers
- [WARNING] a damaged install (app/server.js present, runtime gone) still sent the service key unproven, since
  kosmos_board_proven sends unproven where the proof cannot run (#1765). FIXED: connect refuses there; arm added
  (mutant with the guard removed: the key reaches the squatter, red). A source checkout keeps #1765's behaviour.
- [NIT] refusal advice "Start Kosmos" was wrong (the board is up at that point). FIXED wording + assert.
- [NIT] the hook's "listener changes" arm uses the proveBoard seam, not a second real listener. Kept: it fails on the
  old code (asks once), and the real-board control counts two real proofs.
- [NIT] proof and send are separate connections, so a takeover in the milliseconds between them still lands. Stated as
  a remaining limit: narrowed, not closed, unless the proof is bound to the connection that carries the send.

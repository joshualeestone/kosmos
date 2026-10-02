# siblingbody-4973: another computer's page reads this computer's agents, nothing more

Card: kosmos#4973 (Josh, follow-up from #4812's relay half, kosmos-relay #249 by Baron).

## The gap
#4812 lets a page served from one of the person's computers read another computer's `/api/status` through the browser (the relay adds the CORS pair for the account's listed sibling origins and presents the board token for a `same-site` read). The accepted risk was "the agent list"; the read returned the whole answer: update state, `updateLog` (an absolute path under the install root, likely holding the Mac's user name), world, engine, flags.

## Done looks like
A sibling read of `/api/status` gets `{ agents: [{ sessionName, name, state }] }` (strings only, the guide left out) and nothing else, so "the agent list" is exactly what is read; the board's own page, address-bar loads and the CLI get the full answer as today.

## How the board tells
The relay rewrites `Origin` and `Referer` to the loopback shape before forwarding (crates/tunnel/src/proxy.rs `forward`), so the board cannot see which site asked. It passes `Sec-Fetch-Site` through unchanged, and it is the browser's own provenance (a page cannot set it). The board already reads it the same way (`crossSiteRead`): anything but `same-origin` or `none` is another site. So:
- `isSiblingRead(req)`: `sec-fetch-site` present and not `same-origin`/`none`.
- `statusForSibling(json)`: the three fields the other computer's Agents view uses (web `oaAgentsOf` on Baron's `allagents-4812`), strings only; the guide's row is left out (that view drops it anyway).
- The error answer to a sibling read carries no tmux detail (not tested: a one-line branch; accepted in review 1).
- An old browser's sibling read (no Sec-Fetch-Site) is closed by the relay withholding the token, not by the board (stated in the comment).

## Decisions
- Reduce on the board, not in the relay: the board knows the answer's shape; a relay filter would have to parse JSON and track every new field.
- `cross-site` is reduced too, though the relay gives it no token today (it would read "not signed in"): fail toward less, never more.
- Part 1 of the card (the accepted-risk sentence in kosmos-relay `docs/relay-request-auth.md` and the #4812 plan) lives on Baron's open relay branch, mid-validation. With this change the sentence ("the agent list") becomes true as written, so no edit there is needed; noted on the card for Baron.
- Weakest premise: a future same-site page of the person's own that needs more than the agent list (say, a combined update view) gets only the agents; it would need its own route. Accepted: the card asks for exactly this narrowing.

## Validation
- server.sibling-status-4973.test.js: same-site and cross-site get exactly agents with the three fields, every agent but the guide; same-origin, none and no header get the full answer (control). Removing the one line in the route fails it (measured).
- Every test file that reads `/api/status` plus the file-scanning guards.

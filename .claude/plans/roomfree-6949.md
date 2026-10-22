# roomfree-6949: the person frees a quiet agent's room claim from the board

Card: kosmos#6949 (follow-up to #6946). Claimed: pigeonpete. Stacked on `roomclaim-6946` (9f7c66c1db, Ice Cream Kitty,
in review); rebased onto main once #6946 merges, and the PR opens then.

## Decision
- Engine `freeClaim({project, of, by, members})` beside `claimantsOf` in engine/messages.js. It frees the claim of the
  holder the room shows (members filtered as `roomClaimOf` does), writing one remove row per live 🙋 form with
  `from: <holder>, takenBy: 'you'` (react()'s takeBack shape, so replay takes the pill off), then an agents-only room
  note naming the post and the old holder. Already free is `op: 'none'` and writes nothing.
- `by` is the holder the page drew. If the claim changed hands since, nothing is written and the answer names who holds
  it now (route: 409). A stale page cannot free the wrong agent.
- Route `POST /api/project/:id/room/:postId/free-claim`, beside the person's react route: board-token gated (every
  /api/ POST is), not in AGENT_TOKEN_ROUTES, and refused (403) when the caller presents an agent token. It answers with
  the post's reactions and claim, the react route's shape.
- The person's react route now also answers with `claim` (shared `roomPostClaim`), so the one-row repaint after the
  person agrees with a claim keeps the pill labelled.
- Page: on a room post with `claim`, the 🙋 pill gets `.rxn-claim`, a title and accessible name "Claimed by <name>,
  <age>", and a "Free for another agent" button beside it (always visible, like the pill). Success repaints the row and
  speaks in the room's live region; a refusal or a failed send says why in a toast and leaves the button pressable.

Rejected:
- Letting the person's 🙋 click take the claim (#6946 round 3 removed exactly that: a "+1" click silently took the post).
- Writing the remove rows from the page through the react route: the person's route only toggles the person's own 🙋.
- Putting Free in the hover bar: the claim it acts on is always shown, so its control is too.
- A confirm step before freeing: the agent loses nothing it cannot take back (it can claim again, and the note tells it
  to say so in the room first).

## Proof
- engine/roomfree-6949.test.js: the done-line (ann claims, the person frees, bob claims, the agents-only note names
  ann and the post) with its control first (bob refused naming ann); stale holder refused with nothing written, and its
  control; already free; every 🙋 form removed; the person's own 🙋 and other reactions untouched. Mutants (stale check
  off, takenBy dropped, first form only, note off) each turn one test red.
- server.projects.test.js #6949: through the real route; 409 on a stale holder with nothing freed; the agents' text
  view prints the note and drops the claim line while the page's JSON view leaves the note out; a second free is
  `none`; the post can be claimed again; an agent token is refused. The react route's `claim` is covered (mutant red).
- docs/browser-checks/render-roomfree-6949.js (light and dark): label and Free with a 👍 control post; the repaint
  after the person's own 🙋 keeps them (mutant red); a mocked 409 toast; the real free.

## Weakest premise
That the person can tell a quiet holder from a busy one. The pill shows the claim's age, not whether the agent is still
working; freeing a working agent's claim costs it a re-claim and a line in the room, which the note asks for.
Also: claims are this board's rows, so a federated room's other computers neither see the claim nor the free.

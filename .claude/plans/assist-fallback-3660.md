# assist-fallback-3660: the setup assistant falls back to the hosted model while their model cannot answer

Card: kosmos#3660. Josh, 2026-09-25 07:22 (#admin 1553018813736427593): use their connected model by default;
if it cannot answer, fall back to Kosmos's hosted model for that chat with a one-line notice, and go back to
theirs once it works (checked on the next message, not continuously). Kosmos side is Renet's; the notice is
Mona's. The contract was posted on #3660 before building.

## What
- `engine/setup-assistant.js` `guideFailure(card)`: the guide agent's card is failing when its state is
  `rate_limited`, `auth_failed` or `connection_lost`, the states #3723 surfaces. Returns `{ problem, runner }`.
- `hostedWhy({ failing })`: after the connector check, a failing guide is `{ ok: true, why: 'own_model_failing' }`.
  It is checked before the account listing, since a guide implies a connected model.
- `server.js` `setupGuideFailing()`: the seeded guide's card from `safeRoster()`, read by `guideFailure`.
  `GET /api/setup-guide` with a failing guide answers `{ ok: true, name, hosted, hostedWhy, problem, runner }`.
  `POST /api/setup-guide/hosted` passes the same `failing` to `hostedWhy`, so it answers while the guide fails
  and refuses with `own_model` once it answers again.
- With no connector, GET does not read the board and answers the plain `{ ok: true, name }` (contract change
  from the first post: `problem` is not sent there).
- A guide card that cannot be read (the board, or the removed list) is `unchecked`: GET says
  `hosted: false, hostedWhy: 'unchecked'` and the hosted route answers a retryable 503, never `own_model`,
  which would end a fallback chat over a board hiccup.

## Decided
- Failure is read from the guide's own card, not from a new probe: the board already classifies these states
  from the pane, and #3723 uses the same ones. No private vocabulary: `problem` is the card's state.
- A `stopped` guide is not a fallback case: that is our agent not running, not their provider failing.
- The caps are the coordinator's and unchanged.
- No separate refusal code for "your own AI is answering again" (review round 3 asked for one). Rejected: the
  bubble steps aside only on `own_model` (web/index.html, the `stepAside` test), so a new code would break the
  live hand-over to a newly created guide; and the server cannot tell a recovered guide from a new one, both
  are "a guide that answers". The bubble can: it knows it entered the chat on `own_model_failing`, so Mona's
  notice picks the sentence from that.

## Weakest premises
- The card state lags the pane: a guide that just failed reads failing only once the board classifies it, and
  one that just recovered keeps the fallback until its card changes. It is checked per message, as asked.
- An install with a model but no guide (the guide was never created) still gets no assistant; this change is
  about a guide that exists and cannot answer.
- `GET /api/setup-guide` reads the board (safeRoster, which captures every pane) when a guide exists. The reading
  is kept for 15 seconds, longer than the bubble's poll (about 6 seconds apart), stamped after the read, so a
  flip back can wait that long.
- **Server half only.** The bubble does not read `hosted` on a guide yet (Mona's half), so the fallback is not
  reachable from the product until that lands; the route already accepts a hosted chat while the guide fails.

## Verification
- `engine/setup-assistant.fallback-3660.test.js` (guideFailure, hostedWhy) and
  `server.setup-guide-fallback-3660.test.js` (each failing state through the real routes, the flip back, no
  connector). Mutations: never failing, the GET branch removed, the POST route unaware, `idle` counted as
  failing: all RED. Round 3: the stamp moved before the read, a 5-second TTL, an unreadable board read as
  answering, hostedWhy swallowing a failed read, GET reading the board with no connector, an unchecked removal
  read as no guide: all RED (the flip back is tested with an injected clock, memo live).

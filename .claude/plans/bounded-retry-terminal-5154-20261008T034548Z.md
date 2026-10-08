# #5154 remainder — Slice C: a recurring TERMINAL error, bounded and named

Branch `bounded-retry-terminal-5154`, off main `31e3b7eaf`. Addresses #5154 (non-closing). Claimed `claimed:johnnycage`. Design posted on the card (johnnycage, 2026-10-08). Ruled in by Liu Kang (m4758).

## Goal (what "done" looks like)
When a Kosmos-run agent is stuck on the **same terminal error repeating** — an expired login (`auth_failed`) or a rate limit that never lifts (`rate_limited`) — for a conservative, logged threshold, Kosmos raises **one** needs-you per episode that **names what happened and what the person must do**, clears itself when the agent recovers, and never masks the agent's own needs-you. This is the "same error repeating" half of Josh's ask; slice A did "the same restart", slice D (the "same tool refusal" inside a turn, per-runner hooks) is a separate large card.

## Why this is not already built (verified on origin/main)
- `engine/crashloop.js` (slice A) bounds process crash loops only.
- `engine/loginexpiry.js` (#3532) warns BEFORE a login expires (forward-looking, from the refresh-token date). It does NOT bound a RECURRING `auth_failed`. So slice C is distinct, not a duplicate (the repo's "two derivations of one fact" caution — slice C must not restate loginexpiry's signal).
- `engine/status.js` already classifies `auth_failed` and `rate_limited` (rule 3b), distinct from transient `conn_lost`. That classified state over time is slice C's signal.
- There is no "Kosmos-raised needs-you" abstraction beyond crashloop today.

## Design (mirror slice A's shape)
1. **New detector `engine/<name>.js`** (working name `stuckterminal.js`): given an agent's current classified state + a small per-agent history of (state, firstSeenAt), decide whether the SAME terminal error has stood continuously for `>= STUCK_MS` (start conservative, e.g. 15 min) across `>= STUCK_READS` status reads. Pure + unit-tested like crashloop.js (assess()/read()). Only `auth_failed` and a non-lifting `rate_limited`; never `conn_lost` (transient), never `needs_you`/`working`/`idle`. Clears when the state leaves the terminal set.
2. **Per-agent field on `/api/status`** (sibling to `crashLoop`, e.g. `stuckError`) — board turns it into a card naming the error. Only for agents Kosmos runs (`isNamedOurs`).
3. **One push per episode:** a periodic sweep (beside `crashloop.tellLoops` in server.js ~21229) fires exactly one `phonenotify.happened({ kind:'needs_you', id:'stuckterminal:'+key+':'+firstAt, ... })` per episode; logs each detection first (false-alarm discipline).
4. **Copy to Mona Lisa.** Draft: pill "Needs a hand"; sentence names the error + the action ("Kosmos has seen <agent> stuck on an expired login for ~15 minutes. Reconnect its account in Settings, then it will pick up where it left off." / "...a rate limit that has not lifted for ~30 minutes. It will keep trying; nothing to do but wait, or switch its model.").
5. **Lifecycle hooks:** `forget` on remove/create/delete-leftover (as crashloop); exclude anything Kosmos itself is acting on.
6. **Precedence (hard rule):** the raised item carries its own evidence and never hides/replaces the agent's own needs-you; it clears itself.

## Threshold & false-alarm discipline (the chief risk)
- Conservative defaults, every detection logged before it pushes; a healthy agent must never trip it.
- An `auth_failed` that a reconnect clears quickly must NOT fire (require continuous persistence past `STUCK_MS`).
- A `rate_limited` that lifts on its own must clear without firing.
- Tune `STUCK_MS`/`STUCK_READS` from real logs; state plainly if no history exists to tune against (as slice A did).

## Out of scope
- Windows (its supervisor/state path differs; Homer's spec) — Mac-first, like slice A.
- Slice D (same tool refusal inside a turn; per-runner tool hooks) — separate large card.
- Slice B (route other existing bounds through the record) — optional later; note the self-heal give-up is already surfaced.

## Tests & gates
- Unit test for the detector (`<name>.test.js`): fires only past threshold; clears on recovery; ignores `conn_lost`/healthy; excludes deliberate/Kosmos-acted states; stable per-episode id.
- A server-path test that the `/api/status` field + the one-push-per-episode sweep behave (mirror `server`-side crashloop tests).
- If the board card is a rendered surface change → a `docs/browser-checks/` assertion or a `Browser-check:` trailer (repo convention #4).
- Full local `tools/run-tests.sh` (unset KOSMOS_AGENT_TOKEN) + `/challenge-loop` to convergence, then `/create-pr`.

## To confirm at implementation start
- The cheapest place to read a per-agent terminal-error duration on the 5s status path without a second derivation of the state (reuse status.js's existing classification; do not re-derive it).
- Whether `rate_limited` has a usable "first seen" anchor or needs one recorded (like crashloop's run files).

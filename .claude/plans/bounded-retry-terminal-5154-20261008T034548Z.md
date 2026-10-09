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

## SUPERSEDED during the challenge-loop (read this first)
The two sections below describe an EARLY **in-memory `STUCK_BOOK`** design. The shipped implementation
moved the anchor **to disk** (`store.ROOT/stuck/<key>.json`), because iteration-1 review found that an
in-memory Map in server.js cannot be reached by `forget` from engine/create.js, remove.js and
delete-leftover.js — so a removed-and-recreated agent of the same name would inherit the old episode's
clock (the chief risk). Disk-backing (mirroring crashloop's run files) makes `forget` cross-module, and
`dir()` reads `store.ROOT` at call time so convention #2 still holds. `assess(anchor, now)`, `read`/`peek`
take a key (not a `book` Map), the sweep skips on a failed roster read and prunes departed agents on a good
one, and writes are atomic (tmp + rename). Treat the two sections below as the original plan of record, not
the final shape.

## Implementation approach (grounded on origin/main)
- **Signal is already on the snapshot:** each agent object `a` carries `a.state` (e.g. `a.state === 'connection_lost'` drives the `reconnect` field; `auth_failed`/`rate_limited` are the terminal values from status.js's classification). So slice C reads the EXISTING classified state — it does not re-derive it (two-derivations caution satisfied). Plug-in point: beside `crashLoop: a.isNamedOurs ? crashloop.read(...)` (server.js ~5330) add `stuckError: a.isNamedOurs ? stuckterminal.read(STUCK_BOOK, a.sessionName, a.state, now) : null`.
- **"First seen stuck" anchor = in-memory, not disk.** `a.state` is only the CURRENT state, so I must record WHEN the agent entered it. Use a server-side `Map` (`STUCK_BOOK`, mirroring the existing `CONNLOST_BOOK` pattern) updated each poll: if `a.state` is terminal and equals the recorded one, keep the anchor; if it changed (or left the terminal set), reset/clear. No per-poll disk write (cheaper than crashloop's file read, appropriate for the 5s path).
- **Detector `engine/stuckterminal.js` (pure, unit-tested):** `TERMINAL_STATES = ['auth_failed','rate_limited']`, `STUCK_MS` (conservative), `assess(state, anchor, now)` → `{ stuck, state, sinceAt }`; `read(book, key, state, now)` updates the anchor and returns the assessment; `forget(book, key)` for lifecycle. No `store.ROOT` I/O, so no require-time root freeze to worry about (convention #2 N/A here).
- **One push per episode + board field + copy + precedence + lifecycle:** as in the Design section above (sweep beside `crashloop.tellLoops` ~21229; `id:'stuckterminal:'+key+':'+sinceAt`; `forget` on remove/create/delete-leftover; never masks the agent's own needs-you; clears on recovery).

## Resolved wiring architecture (grounded on origin/main — ready to implement)
The pure detector (`engine/stuckterminal.js`) + 9 unit tests are **built and green** (committed). The server wiring is the next unit:

- **Single authoritative updater = the 60s sweep.** Unlike `crashloop.read` (a stateless disk read), `stuckterminal.read` MUTATES the anchor, so it must run once per poll from ONE place. The existing `crashLoopTick` (server.js ~21292) already calls `safeRoster()` every 60s; the stuck sweep rides the SAME roster read (no extra snapshot — the cost the crashloop comment warns about is already paid there). For each roster agent: `stuckterminal.read(STUCK_BOOK, key, a.state, now)`; on `stuck` fire once per episode via a `STUCK_TOLD` Set (mirror `CRASHLOOP_TOLD`) + log first, then `phonenotify.happened({ kind:'needs_you', id:'stuckterminal:'+key+':'+r.sinceAt, ... })`; clear the TOLD entry when no longer stuck. `safeRoster()` carries `a.state` (verified: it is built from `snapshot()`, e.g. the `a.state === 'connection_lost'` reconnect line at ~2428).
- **`/api/status` is READ-ONLY** (no book mutation): attach `stuckError: a.isNamedOurs ? stuckterminal.assess(STUCK_BOOK.get(a.sessionName) || null, now) : null` beside `crashLoop` (server.js ~2432 and ~5331; check ~5547's `k` loop carries state). The board reads the current anchor assessment; the 60s granularity is irrelevant to a 15m/30m threshold.
- **`STUCK_BOOK = new Map()`** declared beside `CONNLOST_BOOK` (~1113). In-memory only (a restart re-anchors from the live state, which is correct). No `store.ROOT` freeze (convention #2 N/A).
- **Precedence is STRUCTURAL, not a special case:** an agent showing its own `needs_you` is, by status.js classification, NOT in `auth_failed`/`rate_limited`, so stuckterminal cannot fire over it. It also clears itself (anchor drops when the state leaves the terminal set). Both satisfy the card's precedence rule for free.
- **Lifecycle:** add `stuckterminal.forget(STUCK_BOOK, key)` beside each existing `crashloop.forget` (remove.js ~817, create.js ~4957, delete-leftover.js ~533), and prune book entries not in the current roster during the sweep.
- **Confirmed:** `rate_limited` uses a longer threshold than `auth_failed` (a rate limit legitimately persists; an expired login does not self-heal) — encoded as `STUCK_MS = { auth_failed: 15m, rate_limited: 30m }`. The terminal spellings `auth_failed`/`rate_limited` match status.js `STATE` constants.

## Remaining units (next focused pass, NOT to be interrupted by the #5482 merge)
1. The server.js wiring above (book + sweep + read-only `/api/status` field + lifecycle `forget`).
2. A server-side test (mirror the crashloop server tests): the `/api/status` field + one-push-per-episode.
3. The board card from `stuckError` + Mona Lisa copy; a `docs/browser-checks/` assertion or a `Browser-check:` trailer (rendered-surface convention #4).
4. Full local `tools/run-tests.sh` (unset KOSMOS_AGENT_TOKEN) + `/challenge-loop` to convergence + `/create-pr` (Addresses #5154, non-closing).

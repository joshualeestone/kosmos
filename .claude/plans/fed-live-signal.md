# Plan: federation-live coordinator signal (customer un-hide, option 2)

Branch: `fed-live-signal`  ·  Card: the customer-un-hide launch blocker (Splinter GO 2026-09-21, option 2)

## Problem

`federationLive` (the coordinated flip that un-hides the federation UI) is ENV-ONLY:
`federationLiveNow()` in server.js returns `process.env.AGENT_WORKFORCE_FEDERATION_LIVE === '1'`,
default false. That works for an OPERATOR-controlled board (set the launchd env + restart = the
fleet/dev verification), but a CUSTOMER runs their own board and cannot set env vars. So on a
customer 0.6.84 board federationLive is always false and the fed UI never un-hides. The merged
code comment itself flags "who sets it, where -- is likewise pending." This is the launch blocker.

## Chosen approach: option (2), a coordinator/remote signal

The board fetches a GLOBAL "federation live" bool from the coordinator, EXACTLY the shape as the
W1 standing re-fetch (#3355): a lazy, TTL'd, non-blocking, single-flighted, best-effort refresh of
a cached value that `/api/status` serves. Central on/off + rollback-without-a-release. Splinter's
GO; the coordinator-side field is Baron/ICK's lane (routed after their wire-proof); I build the
board side and finalize the exact endpoint/field with ICK.

`federationLiveNow()` becomes `env-flag OR cached-coordinator-flag`, so:
- the env flag stays as the operator override (fleet/dev boards), backward-compatible;
- the coordinator flag is the customer mechanism (no per-customer action).

### Why global, not per-account (the one design difference from W1)

`standing` is per-account (Kosmos+ membership) and gates on `enrolled()`. `federationLive` gates
the WHOLE fed UI including the "sign up for Kosmos+" prompt shown to NON-members, so every board
(enrolled or not) needs it. Therefore the federation-live refresh must NOT gate on `enrolled()`,
and its fetch is a GLOBAL (not mac-signed-per-account) read.

## What ships in THIS PR (contract-independent, fail-safe)

1. `engine/remote.js`:
   - a global fed-live cache in the state file: `fedLive` (bool) + `fedLive_at` (ms).
   - `FED_LIVE_TTL_MS` (60s, mirrors STANDING_TTL_MS).
   - `fetchFederationLive()` — the isolated coordinator read. **Null-stub pending ICK's endpoint**,
     exactly as `fetchStanding()` shipped a null stub pending ICK's mechanism answer. Returns null
     -> the refresh is a safe no-op and `federationLive()` keeps the default (false) -> the producer
     behaves EXACTLY as the merged #3353 env-only producer until the real fetch is wired.
   - `refreshFederationLiveIfStale(opts)` — mirrors `refreshStandingIfStale` but NOT gated on
     `enrolled()` (global). Non-blocking, single-flighted, best-effort. A definite bool updates the
     cache + resets the clock; a null KEEPS the last-known value and backs off to the next TTL.
   - `federationLive()` accessor — returns the cached bool; fail-safe false when unknown.
   - export the new surface.
2. `server.js`:
   - `federationLiveNow()` = `(env === '1') || remote.federationLive() === true`.
   - fire `remote.refreshFederationLiveIfStale()` non-blocking from `/api/status` (mirrors how
     `fedKosmosPlusNow()` fires the standing refresh) — never blocks the poll.
3. Tests: `engine/remote-fed-live-refresh.test.js`, mirroring `remote-standing-refresh.test.js`:
   flip-on / flip-off / null-keeps-last / single-flight / never-throws / not-gated-on-enrolment /
   default-false. NODE_TEST_CONTEXT guard: no real coordinator dial under test.

## Fail-safe invariant (the safety of shipping ahead of the coordinator field)

Until ICK's endpoint is wired, `fetchFederationLive()` returns null -> cache stays false ->
`federationLive()` is false -> `federationLiveNow()` = env-only = the merged #3353 behavior. So this
PR changes NOTHING observable until (a) the real fetch is wired AND (b) the coordinator returns true.
Default hidden; any unknown/false/unreachable -> hidden. The fed-route 403 (`kosmos_plus_required`)
remains the hard security gate; this only makes the UI honest, same as W1.

## Follow-up (not this PR)

- Coordinate the exact endpoint/field with ICK/Baron (my proposal: an unauthenticated global
  `GET /v1/meta` carrying a `federation_live` bool, since /v1/meta already returns 200 and this is a
  public launch flag; a per-account mac-signed path is wrong for a global flag). Then wire the real
  `fetchFederationLive()` (a one-function change) + a real-coordinator verification.
- The staging re-cut (Splinter's lane) must carry #3353 + #3355 + this before the real-board flip
  verification can pass.

## Verification

- `node --test engine/remote-fed-live-refresh.test.js` green + the existing remote/standing suites
  still green (no regression to the env-only path).
- Full node suite before PR (CI runs `engine/*.test.js *.test.js`).
- No web/index.html or browser-check change (pure engine/server), so no browser-check index touch.

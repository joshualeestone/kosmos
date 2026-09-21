# Federation Kosmos+ gate (launch)

## The spec
Josh, 2026-09-21 (via Splinter). Federation goes live as a **Kosmos+** feature:
- Un-hide the federation UI (currently hidden on prod by the #3330 sourceChannel gate)
  ONLY for logged-in + authenticated **Kosmos+ members**.
- Everyone else (not logged in / not a member) gets a **"sign up for Kosmos+" prompt**
  instead — an actual go-sign-up, not a hidden/absent UI.
- Coordinate with ICK/engine for the Kosmos+ auth-state signal (the entitlement check).
- 🛑 BUILD + PR **ready-to-flip**, but DO NOT flip live on prod. One coordinated launch
  flip AFTER slice-3 (the m2m message pipe) is e2e-proven. Splinter coordinates the flip.

## What "done" looks like
- A member on a live channel sees the fed UI; a non-member/not-logged-in sees a sign-up
  prompt; before the flip, prod shows nothing (the old #3330 state, preserved).
- FAIL-SAFE: a member-only paid feature NEVER leaks to a non-member/unknown on prod.
- Merging changes NO visible behavior today (prod stays hidden, staging still shows).
- The flip is engine-side (a `federationLive` signal), no web redeploy.

## Design
- **`fedGateMode(sourceChannel, federationLive, plusEntitled)`** — a pure, unit-tested
  function returning `'show'` / `'signup'` / `'hidden'`:
  - staging is always a live review surface; prod is live only once `federationLive===true`.
  - not live -> hidden. live + member -> show. live + non-member -> signup.
  - live + UNKNOWN entitlement -> signup on prod (fail-safe); -> show on staging only
    (review continuity while entitlement is not yet wired).
- **`fedGateStamp(data)`** stamps the computed mode on `<html>` as `data-fed-ui`.
- **CSS**: two fail-safe hide-unless rules — the fed entry points hidden unless mode is
  `show`; `#pj-plus-signup` hidden unless mode is `signup`. Before the first tick there is
  no `data-fed-ui`, so both hide (no first-tick flash / leak).
- **`#pj-plus-signup`** markup (a quiet card) + **`fedPlusSignupGo()`** routing into the
  in-app Kosmos Plus section via `showTab('settings'); settingsGo('plus')` — no hardcoded
  domain (Josh's ruling: the Plus section owns where sign-up goes).
- Replaces the #3330 `data-source-channel` gate + its check `render-fed-prod-gate-3330.js`.

## The ICK/engine seam (membership CONFIRMED; two reads still to settle)
The Kosmos+ **membership** signal is distinct from `engine/subscription.checkMachine()`
(that is the CLAUDE-AI sub) and was genuinely unwired.

**CONFIRMED by ICK (kosmos-relay `fed-plus-gate-3311`):** the membership signal is a
boolean **`kosmos_plus`** (== the coordinator's `standing == "good"`), the SAME field the
coordinator's own gate reads, on `GET /v1/account/me`. The gate now reads `data.kosmos_plus`
(bool: true -> show, false -> sign-up) and ignores the fed-route 403's body (no machine
`code` field, by ICK's anti-probing design). `fedGateMode` takes the bool directly.

**Two reads still to settle with ICK (asked; both fail-safe until wired):**
1. **Membership endpoint.** `kosmos_plus` is on the RELAY's `/v1/account/me`; my gate reads
   the LOCAL board's `/api/status` poll. Assumed: the local server surfaces `kosmos_plus`
   on `/api/status` (proxied via the engine's relay seam). If instead the frontend must call
   `/v1/account/me` directly, only fedGateStamp's read changes (a client-side fetch).
2. **The flip signal.** `federationLive` (kept separate from membership, so prod stays
   hidden even from members before slice-3) — where the server exposes it + who sets it
   (Splinter's config) is TBD. Absent today -> `hidden`, so nothing flips until wired.

Reads are isolated in `fedGateStamp`; each is a one-line swap. Fail-safe: absent
`kosmos_plus` -> sign-up (never leak), absent `federationLive` -> hidden.

## Verification
- `web.fed-plus-gate.test.js` (5): fedGateMode modes, the fail-safe (unknown/absent on a
  live prod is never `show`), ready-to-flip (prod hidden until federationLive true), and
  the page wiring (stamp + CSS + prompt + no hardcoded URL).
- `render-fed-plus-gate.js` (14 arms, real Chromium): every mode's computed display incl.
  the LEAK control (prod live + unknown -> fed hidden, sign-up shown) and the sign-up
  button ROUTES into the Plus section.
- Full web suite 1519 pass, server 305 pass, surface + coarse browser-check gates green,
  screenshots of both states (member toggle / non-member sign-up card).

## Why it is safe to merge now
`data.federationLive` is absent today -> `fedGateMode('prod', undefined, …)` = `'hidden'`
-> prod shows nothing, exactly as #3330 did; staging (unwired entitlement) = `'show'`,
exactly as #3330 did. Merging is a no-op on live behavior. The flip is a later engine-side
signal Splinter coordinates. Pixel/night-mode QA is Josh's on the cut.

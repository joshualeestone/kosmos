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

## The ICK/engine seam
The Kosmos+ **membership** signal is distinct from `engine/subscription.checkMachine()`
(that is the CLAUDE-AI sub) and is genuinely unwired today (the Plus section is
"shipped unwired" — nothing tells the app whether the person has paid). Two /api/status
fields are needed from ICK: `federationLive` (the flip) + `plusEntitled` (member state).
Proposed names are used as PLACEHOLDERS, isolated in `fedGateStamp`, so wiring the
confirmed fields is a one-line edit. Asked ICK; fail-safe defaults keep it safe meanwhile.

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

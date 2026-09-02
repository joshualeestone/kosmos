# firstrun-foundstub-1845 -- stub /api/found-agents in render-first-run's fleet endings

Card: kosmos#1845. `docs/browser-checks/render-first-run.js` drives its fleet-ending
shots against the **live** `/api/found-agents` route (it stubs `/api/machine`,
`/api/first-run`, `/api/you` per shot but never `/api/found-agents`). The fleet
ending's painter fires the search itself: `frPaintFleet()` runs `if (FR_FOUND ===
null) frFindAgents()` on every path, so each ending shot triggers a real disk
search inside the shot's settle window, on the release-blocking gate.

## What I re-measured (the card's specifics are stale; the core is real)

The card was filed 2026-09-01; #1801/#1214 reworked these files this morning, so:
- **Stale:** the card says `click-first-run.js` stubs `/api/found-agents` at lines
  141/650/750. Current `click-first-run.js` references `found-agents` **zero**
  times. So there is no sibling precedent to copy; the fix is derived from the
  page, not the sibling.
- **Stale:** the card names the shot `firstrun-7-adopt.png`; #1801 renamed the
  fleet shots to content-based names (`firstrun-fleet-adopt/create/cannot-see`).
- **Stale reasoning:** the card says a shared `{ok:true,agents:[]}` stub would
  make the adopt shot "a picture of the adopt ending with nothing found, which
  fleetCount:14 contradicts." **Measured false against current code.** The adopt
  count is `FR.fleetCount` (from `/api/first-run`), NOT from found-agents. The
  adopt branch renders "You already have 14 agents here" *exactly when*
  `frFoundOffer().length === 0`. So an **empty** found-agents stub produces the
  correct adopt screenshot; a 14-agent list would flip it to the frPaintFound
  "We found 14 agents on this computer" **offer** screen -- a different ending.
- **Real and current:** render-first-run stubs `/api/found-agents` 0 times, the
  fleet endings fire it live, so the shots are non-deterministic (depend on the
  real disk + timing) and slow on the gate.

## The fix

1. Add a per-shot `found:` field to the SHOTS that reach `#fr-fleet`, and a route
   in the per-shot setup loop (mirroring the existing `first`/`machine`/`you`
   pattern):
   ```js
   if (shot.found !== undefined) {
     await page.route('**/api/found-agents', (r) => r.fulfill({ json: shot.found }));
   }
   ```
2. Give each fleet ending a deterministic stub that depicts its canonical PATH
   ending (the shot's name is the claim):
   - `firstrun-fleet-adopt` (FLEET_ADOPT, path adopt, count 14): `found: { ok:
     true, agents: [] }` -> no offer -> "You already have 14 agents here."
   - `firstrun-fleet-create` (FLEET_CREATE, path create, count 0): `found: { ok:
     true, agents: [] }` -> "Create your first agent."
   - `firstrun-fleet-cannot-see` (FLEET_BLIND, path unknown): the "could not
     look" state -> stub a non-ok body (`{ ok: false }`) so `frFindAgents` sets
     FR_FOUND to its documented fallback, matching a machine whose roster could
     not be read. (Confirm the unknown arm's depiction by running.)
   - The last-step block (separate, navigates to `#fr-fleet`): stub empty so it
     is deterministic too.
3. **Add a per-ending assertion with a control** (currently the fleet shots are
   unasserted screenshots; this fix changes what they depict, so it must be
   guarded, not just prettified): after each fleet shot, assert the ending's
   headline text (e.g. adopt -> /already have 14 agents/, create -> /create your
   first agent/i, cannot-see -> the unknown headline). Control: a wrong stub (or
   the live route) would fail these, so they are not vacuous.

## Verification (measured, not assumed)

Boot a sandboxed server and run the check headless via pw-runtime (render-first-run
stubs the other routes itself, so a plain board is enough):
```
SB=$(mktemp -d)
AGENT_WORKFORCE_DATA="$SB/data" AGENT_WORKFORCE_WORKERS="$SB/workers" \
  AGENT_WORKFORCE_LAUNCH="$SB/launch" AGENT_WORKFORCE_PROJECTS="$SB/projects" \
  AGENT_WORKFORCE_DRY_RUN=1 PORT=4399 node ./server.js > "$SB/server.log" 2>&1 &
# wait for /api/status, then:
NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-first-run.js /tmp/frshots
```
- Confirm the check passes (no rendering problems) with the stubs in place.
- Inspect the three fleet-ending PNGs to confirm each depicts its canonical ending.
- Control: temporarily point a fleet shot at a wrong stub and confirm the new
  per-ending assertion goes red (so it is not vacuous).
- web/-gate: this is a docs/browser-checks change only (no web/ change), so the
  #1720 gate is not triggered; still, run tools.browser-checks-wired.test.js.

## Weakest premise (named)

The intended depiction of `firstrun-fleet-cannot-see` (the unknown/blind path).
The card does not pin it and I have not yet read the unknown arm's full render.
I will read it and run the shot before finalizing that stub; if the unknown
ending depends on found-agents differently than adopt/create, I adjust the stub
and the assertion to match what the arm actually renders.

## Card is stale in specifics -> I will comment the re-derivation on #1845 so the
next reader does not chase the 141/650/750 line numbers or the "match 14" fix.

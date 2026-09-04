# Plan: #2019 disruption in-progress state, PRESENTATION half

Branch: `disruption-presentation-2019`. Card: kosmos#2019 (MIXED). Lane: design/content
(Mona Lisa). Design spec: `Josh-Brain/Projects/kosmos-disruption-state-2019-design-spec.md`.
Engine half: Renet Tilley (branch `disruption-state-2019`), who handed me the exact contract.

## Goal (what will be true when done)

A board agent that WE deliberately disrupted (restart / model / provider / instructions /
account) renders as an honest in-progress state, the animated Kosmos K with cause-named copy,
instead of collapsing into "gone" / "this agent doesn't exist". This is the presentation for the
card's "state 4" (see the spec's four-states table).

## The engine contract this consumes (from Renet)

- `a.state === 'restarting'` (a new state).
- `a.disruption === { cause, startedAt }` (null on every other state). `cause` is a MACHINE
  TOKEN: 'restart' | 'model' | 'provider' | 'account' | 'instructions'.
- The state ENDS both ways engine-side (pane back -> live state; failed restart -> stopped after
  a window), so the presentation never has to time itself out. Until this presentation lands, an
  unknown 'restarting' degrades to CARD_ST.unknown (honest, not "gone").

## Change (web/index.html only, presentation is my half)

- `CARD_ST.restarting = { st: 'restarting', pres: 'on' }` (process is coming back, not gone).
- `GLYPH.restarting`: the Kosmos K (`/icons/kosmos-32.png`) in a `.kspin` span.
- `STATE_COPY.restarting` base label + a shared `stateCopyOf(a)` / `restartingLabel(a)` that
  names the cause: Restarting agent / Switching to <a.modelName> / Switching provider / Restarting
  to apply your changes / Switching account / fallback "Restarting agent" for unknown/absent cause.
  Replaced the three static `copy = STATE_COPY[...]` sites (card, row, detail) with `stateCopyOf(a)`
  so the surfaces cannot drift.
- `boardMods`: a 'restarting' card class (white ground, but carries the solid border + K).
- `stateReason`: the calm because-line "This takes a few seconds. Nothing was lost." (placed first
  so the rate_limited guard does not swallow it).
- CSS: `.astate.st-restarting` SOLID border (never the dashed unknown), `.kspin img` breathes at
  2.4s (opacity + scale, NOT a loader spin), reduced-motion holds the K STATIC and fully visible,
  dark-mode border. All matching the existing card-state animation vocabulary.

## Out of scope (deliberate)

- Wiring the stale-instructions restart to POST `{cause:'instructions'}` (Renet's rec #2). It
  depends on her route change (accept optional cause), which is unmerged, and identifying the exact
  fetch needs care. Fast follow-up once her route lands; until then that path emits the default
  'restart' cause and shows "Restarting agent", which is honest.
- The liveness check / signal / board-read logic (the engine half, Renet's).

## Sequencing / safety

Independent of Renet's engine PR (different files, composes). My change is INERT until the engine
emits state 'restarting' (no agent has it before then), and adds no behavior to existing states, so
it is safe to merge in either order.

## Test plan

`docs/browser-checks/render-restarting-2019.js`: calls the page's global render functions with
fixture agents shaped to the contract (one per cause, both themes), asserting cause-named copy,
presence 'on' (not gone), the 'restarting' card class (never off/unk), the st-restarting solid pill,
the animated K, and the because-line; plus a reduced-motion arm (K animation kbreathe -> none,
opacity stays 1). Positive control: fails on origin/main (the #2019 render code is absent).

# Org chart: green glow for working, red glow for needs-you (#2839)

## Ask
Josh, 0.6.57 live review, 2026-09-11: "It would be awesome if we could see a working state on the
org chart view, like maybe a green glow behind them? and a red glow to ones that need you".

## What finished looks like
On the org chart, each working agent has a green glow behind its node and each needs-you agent a red
glow. Idle/paused/stopped/unknown/restarting agents stay quiet (no glow). The colours match the
agent status colours used on the cards (green = working, red = needs-you), so the two views cannot
drift.

## Approach (web/index.html only, existing data + state model)
- The org node already computes `needsYou = cardStOf(a).st === 'attn'` and renders the needs-you
  corner badge from it. Add `working = cardStOf(a).st === 'working'` and a `glowCls` derived
  needsYou-first (`' onode-attn'`), then working (`' onode-working'`), else `''`. Append it to the
  `.onode` button class. needsYou wins so the rare red is never hidden by a working state (#2146).
- CSS: a soft box-shadow halo behind `.onode .face` per state, in the SAME rgba the cards use
  (working `rgba(47,125,90,.55)`, needs-you `rgba(179,38,30,.6)`). Glow only, no hard ring, so it
  sits behind the context gauge (`.oring`) rather than competing with it. The box-shadow renders
  outside the disc, so the face's `overflow:hidden` does not clip it.

## Decisions / weakest premises
- Reused the node's EXISTING needs-you signal (`cardStOf(a).st === 'attn'`) rather than a new one,
  so the glow and the existing needs-you corner badge agree on the same node. WEAKEST PREMISE: Josh
  wants the glow on exactly the states the cards colour (working/needs-you); if he wants paused or
  blocked to glow too, widen the map, but the cards deliberately keep red to one state ("impactful
  because it is rare").
- Only two states glow; everything else stays quiet, matching the card rule that red covers one
  state.

## Verification
- New web.orgchart-glow-2839.test.js pins the glowCls derivation, the button append, and the
  card-colour glow CSS; it fails against origin/main (feature absent) and passes here.
- Patched web.org-view.test.js's node-markup anchor (it matched the exact `class="onode"` string,
  which now carries `' + glowCls + '`); all its other assertions are unaffected.
- The org view is not renderable from the design-bot session; Josh reviews live.

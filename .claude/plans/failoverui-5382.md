# failoverui-5382: the Settings switch for the Assigner's failover (#5382, second PR)

Stacked on `failover-5382` (the engine, off by default). Until this lands, the failover can only be switched on by a
direct API call.

## Change
- web/index.html, Settings > Automation, inside the Assigner box: a row "Move work when a provider hits its limit"
  with a switch (`#asg-fo-row`, `#asg-fo-toggle`), off by default. The row shows only while the Assigner reads on,
  because failover runs inside it, and only from a read that carries the `failover` field (an older board's answer
  is unknown, not Off). One change per PUT (`{ failover }`), as the route requires. A failed read hides the row too.
- The hint, in Mona's words (approved 09:46 10-06): "When an agent has been paused for 15 minutes by a usage limit
  that says when it ends, Kosmos gives its unfinished tasks to an idle teammate on the same project that uses a
  different provider. They stay with that teammate, and the paused agent is told which ones moved. That teammate's
  work is billed to its own provider's account." "Off by default." is its own paragraph, as on the Recommender.
- Each clause is checked against the engine: dated limits only (`limitedCard`); moved parts stay (no give-back); the
  paused agent is told (`engine/failovertell.js`); the receiver's provider bills (`providerOf`).

## Evidence
- web.assigner-save-3595.test.js: the page's real paintAssigner / paintFailover / saveAssigner functions, with failover
  arms (shown only while on, an older board's read hides it, a failed read hides it, a save sends one field).
- docs/browser-checks/render-assigner-live-3595.js, light and dark: the row is shown and off by default; the hint
  names the 15 minutes, a different provider and billing; a click stores it and leaves the Assigner on; turning the
  Assigner off hides the row and keeps the stored value.
- Design shots ~/work/design-shots/kosmos-5382/ (settings-assigner, settings-assigner-failover; desktop and iPhone,
  light and dark), approved by Mona (layout 08:41, copy 09:46).

# youboot-1071: the About-you block reaches existing agents; the delivery checker stops misreading

Card: #1071 (needs-decision; Liu Kang m1854: re-measure on main, then build or close with evidence).
Guards: Liu Kang m1859.

## Finished means
- A plain board start puts the About-you block ("Who you work for") into every tied agent that has
  an instructions file, and refreshes a stale one. Only when a record is saved: with none it does
  nothing (tellAgent would remove the block, a state the form cannot reach but a boot could),
  and each per-agent write runs with `addOnly`, so a record gone mid-pass is refused, not removed.
  Writes stay inside managed markers: the About-you span, plus the existing colleagues span, which
  tellAgent heals when drifted (projects.healColleagues; never adds one).
- `tools/check-block-delivery.js` has a row for every block in `projects.ALL_MARKERS()`, and reports
  the working rules (doctrine) from `doctrine.planFor` instead of a `read()` that does not exist.
- Card #1071 carries the measurement, the decision, what was rejected, and the weakest point.

## Measurement (origin/main b5c84153, Mortals, 8 agents)
reports/connections (boot-refreshed) 8/8; dmfiles 7/8 (test-1 is not running); you 1/8;
colleagues 1/8 (birth-only for role-template agents, by design); doctrine read STALE on 3 (tool
bug); really behind v15 on all 8, awaiting the consented refresh (#539).

## Decisions
- Build the boot refresh for `you`, the same shape as #1649/#1676/#3614. Not deliberate that it was
  missing: no mention in those cards or PRs; create.js adds the block at birth unconditionally;
  you.js says it is taught to every agent. No consent rule (doctrine's consent is its own module).
- Guard (m1859): it goes through you.tellAgent -> projects.spliceBlock (markers only), refuses two
  blocks, never creates a file. Tested byte for byte.
- Rejected: a one-off bulk sync (the next blockBody edit would strand again); auto-applying doctrine
  (consent-gated, #539); adding colleagues to custom-instruction agents (reverses a create.js rule);
  content-hash staleness in the checker (boot refresh bounds drift to "since last start").
- Weakest point: `you` carries the person's own words, more personal than the siblings. Read as
  consent because the form exists to send them to agents.

## Tests
- server.you-refresh-1071.test.js: add to an existing agent; bytes above and below an old block
  kept; two blocks left alone and the refusal named on stderr; no file invented; nothing saved
  keeps an existing block (red with the saved-guard removed); a drifted colleagues block healed. Red without the fix on both delivery arms; a
  mutation that writes outside the markers fails the byte arm.
- engine/you.test.js: addOnly with the record gone leaves the file byte for byte (red without it).
- tools/test-block-delivery.sh: row count equals ALL_MARKERS()/2; swarm lead/non-lead/unreadable
  profile (red with the swarm branch removed); doctrine behind/current; doctrine
  never STALE. All four new checks fail against origin/main's tool.

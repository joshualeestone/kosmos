# ctwatch-board-6602: the Plus pane shows the tunnel's certificate check, and its switch (kosmos#6602)

Follow-up to kosmos#6588 (tunnel side: kosmos-relay#459). Detail of the underlying item is private.

## What this branch does
- `engine/cert-watch.js` (new): reads `ct-watch.json` from the tunnel state dir and passes on only a state
  (`foreign`, `unknown`, `clear`, `none`), counts and times, never a string from the report (it came from a
  third party). Applies the tunnel's reader rules: a `clear` older than two check spacings (40 h), a damaged
  earlier report, a report that does not parse, or a state it does not know reads `unknown`; any finding,
  including one for an earlier address, reads `foreign`. The switch writes or removes `ct-watch-off`.
- `engine/remote.js`: `certWatch()` / `setCertWatch(on)` over the state dir.
- `server.js`: `GET /api/remote` carries `certWatch`; `PUT /api/remote/cert-watch {on}` sets the switch.
- `web/index.html`: under the status line, one line only when there is something to say (a finding, in
  the danger colour; or "has not been able to confirm anything lately"), and a switch with a label that
  says what it sends where.

## Decisions
- Known gap, decided: `none` (no report yet) never goes stale. Treating a missing report as `unknown` after
  a while would say "cannot confirm" on every install whose tunnel predates the check, until that update
  ships, which is noise. So a tunnel that never writes a report looks like a quiet one. Revisit once the
  tunnel with the check is everywhere (kosmos#6613).
- After Kosmos+ was off for more than two spacings, an old `clear` reads `unknown` until the tunnel's
  first check after it comes back (at session start), so "cannot confirm" can show briefly then. Accepted:
  it is true.
- Clear, never-run and off say nothing: the line is for news. Weakest premise: a person never learns the
  check exists unless they read the switch label; rejected a permanent "checked today" line as noise.
- The switch shows whenever the computer is set up, so the off switch is reachable from the app. The check
  runs in the tunnel, so the label says "While Kosmos+ is on"; with Kosmos+ off nothing is checked.
- With Kosmos+ itself off, the cannot-confirm sentences are not said (the check runs in the tunnel, so
  its silence then is the person's own choice); a finding still is.
- A finding is said even with the check switched off ("The check is off." added), so the switch never
  hides one. Only a finding: an unknown or lost state is not said while off.
- The switch route refuses a computer that is not enrolled (a leftover state dir is not set up), as the
  page shows it only then. A check that keeps failing says so ("has been failing lately"), apart from one
  that has gone quiet. The switch says it is saving (`aria-busy`) while a change is in flight.
- The switch takes effect at the tunnel's next check, with no restart: kosmos-relay's `check_with` looks for
  `ct-watch-off` on every check (read on relay main 16b8c2c9).
- A finding and a lost earlier report together say both sentences.
- The switch route is person-only (`isViaScreen`, 403 otherwise): an agent cannot use this switch. That
  gate is the repo's existing speed bump (a local process that sends a browser header passes it), not a
  wall; recorded for kosmos#6613 beside the Kosmos+-off path. It can
  still stop the check another way, by turning Kosmos+ off (`PUT /api/remote`, which is not person-only),
  and with Kosmos+ off the cannot-confirm sentences are quiet. A finding is still shown. Recorded for
  kosmos#6613 with the other Kosmos+-off gaps.
- A finding only for a previous address, and a lost (damaged) earlier report, each have their own
  sentence. Known gap: the tunnel asks the board to acknowledge a lost report (it stays until a person
  has looked); this branch ships no acknowledge, so that sentence stays until the state dir changes. Owner: kosmos#6613.
- Known gap, follow-up: a finding shows only in the Settings Plus pane. Nothing else on the screen (a
  badge, a banner) raises it, so a person who never opens Settings never sees it. Next step (kosmos#6613):
  surface a `foreign` state where the person already looks (the remote-access bar or a notice).
- No acknowledge button yet: a finding stays until the tunnel's report changes. Rejected for now, a
  "dismiss" would hide a security finding with one click; revisit with a design review.
- The status line is never hidden (a live region must be in the page when its first text arrives); empty, it
  takes no room.
- The report's field names and types are pinned by a sample shaped as kosmos-relay#459 writes it.
- Wording is mine and reversible ("Warning: ... did not ask for. Someone else may be able to pose as this
  computer."). It does not tell the person what to do next, because there is no support path to name yet.

## Proof
- `node --test engine/cert-watch.test.js` (11), `web.plus-cert-watch-6602.test.js` (9), the Plus panel browser check `render-plus-panel-3829.js` (a connected pane with a finding, a clear check, and the switch, each with its control), and the new
  `server.test.js` route test (by name).

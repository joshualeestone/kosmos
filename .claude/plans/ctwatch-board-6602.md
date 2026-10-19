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
- Clear, never-run and off say nothing: the line is for news. Weakest premise: a person never learns the
  check exists unless they read the switch label; rejected a permanent "checked today" line as noise.
- The switch shows whenever the computer is set up, so the off switch is reachable from the app. The check
  runs in the tunnel, so the label says "While Kosmos+ is on"; with Kosmos+ off nothing is checked.
- With Kosmos+ itself off, the cannot-confirm sentences are not said (the check runs in the tunnel, so
  its silence then is the person's own choice); a finding still is.
- A finding is said even with the check switched off ("The check is off." added), so the switch never
  hides one. Only a finding: an unknown or lost state is not said while off.
- The switch route is person-only (`isViaScreen`, 403 otherwise): an agent cannot turn the check off.
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
- `node --test engine/cert-watch.test.js` (10), `web.plus-cert-watch-6602.test.js` (9), and the new
  `server.test.js` route test (by name).

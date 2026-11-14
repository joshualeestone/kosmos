# connfound-8519: which actions of a connection work, as the agents found them (kosmos#8519)

From agent feedback (11-14): an agent using a connected CRM could only learn which actions worked by trying each one.
Splinter handed it to Mona Lisa (09:30 CST) to design and scope. The call and its revision are on the card.

## The call
Kosmos cannot see which actions a connection allows: its checks (engine/tokendoors.js) confirm a token works and read
no scopes, and a plugin added in the person's own Claude or Codex app is not Kosmos's at all. Probing each action live
is ruled out (the search services bill per call, #1636; a write cannot be tested without writing). So this records
what agents FOUND, and shows it to the person and to the next agent.

## Change
1. `engine/connfound.js` (new): the store (store.ROOT/connfound.json; latest outcome per service and action; 30 days;
   50 actions per service; 60 services), `record`, `list`, `renderLines` (the CLI words, shared by both CLIs),
   `parseMcpTool` (mcp__<server>__<action>, provider prefixes dropped), and `classify` (an error line to an outcome,
   or null). Outcomes: not-offered, needs-scope, needs-permission, off-by-policy, failed, works.
2. `server.js`: POST /api/toolfail (#6071) also passes a failed call to `noteToolFailure`, which records only a
   plugin action that the service refused in a way that says something about the action. The error line is sorted,
   never stored. GET /api/connections/found (the disk only, refused cross-site) and POST /api/connections/found
   (the caller named by resolveAgentSender, token first, as toolfail; never a name from the body). Both are in
   AGENT_TOKEN_ROUTES; the POST is in WORLD_CHECKED_AGENT_ROUTES, as toolfail.
3. Both CLIs (`install/kosmos`, `tools/windows/kosmos-cli.js`): `kosmos connections found <service> <action> <outcome>
   [note]` and `kosmos connections --found [service]`; the plain listing adds one line when agents found actions that
   do not work.
4. `engine/connectionsguide.js`: one section telling agents to check `--found` first and to record a refusal.
5. `web/index.html`: Settings > Connections ends with "What your agents found" (hidden until something is found):
   Kosmos's own connections first, then the services agents use outside Kosmos; a fold per service.

## Decided
- Found, not probed (above). Rejected: a hand-written per-service action catalogue (drift; misses plugins); per-service
  scope reading (only a few services expose scopes; GitHub could be a later card).
- Automatic only for failures that are about the ACTION. A bad input, a timeout, or an unrecognised error records
  nothing: a confident wrong word on the page is worse than none. Claude Code's own permission refusals are never
  recorded (they are this computer's settings).
- "Works" is recorded only by hand: the hook does not see successful calls.
- An action no agent tried is not listed. The page says so, rather than inventing a "not tried" row.
- A note is at most 200 characters and refused if the diagnostics redactor would change it.
- Weakest premise: that the pattern sort is right often enough. It errs to recording nothing; "Failed, reason
  unknown" is only ever recorded by hand.

## Tests
- engine/connfound-8519.test.js: parsing, the sort (with a control that the local-refusal guard is what decides),
  recording, refusals, expiry and caps, an unreadable store, renderLines.
- server.connfound-8519.test.js: toolfail feeds it; the error line is never stored; the POST names the caller from
  its token; Kosmos connections filed apart; ?service= narrows; cross-site refused.
- cli.connfound-8519.test.js: both CLIs, found / --found / the plain line; the metered sweep is never asked.
- server.agent-token-sender-570.test.js: the pinned route set gains the two routes, with the reason.
- docs/browser-checks/render-conn-found-8519.js (52 checks): 1280 and 390, light and dark, order, fold words, rows,
  width, 4.5:1, markup shown as text; CONTROLS: nothing found and a failed read leave the box hidden. Wired in
  gated.txt and the README.
- Gates: browser-check gate (#1720) and surface gate (#2518) pass on the branch; the three 'grid' surface hits are
  overridden per check (only .cf-acts li uses grid, inside the new section).

#### Iteration 1 (sonnet)
- WARNING fixed: classify was too loose. "401 Unauthorized: token expired", "is not allowed to be empty", "field forbidden
  must be string" and "File type not supported" were labelled as capability errors. 401 and a bare "unauthorized" now
  record nothing (an expired sign-in is not a refused action); "forbidden" counts only on its own or with 403; "not
  allowed to" only before a verb; "not supported" only about the tool or action. The reviewer's cases are tests now,
  with controls that the same words about the caller still count; with the old patterns the test goes red.
- NIT fixed: a test pins that a later refusal replaces an earlier works (the latest finding wins, either way).
- NIT fixed: a comment on why the record uses agent_board_token and the read board_token.
- NITs left: action names are case-sensitive keys ("Create Release" and "create release" are two rows; agents copy
  the tool's own name, so rare); a retried POST can count one extra time in "N times" (n is a hint, not a ledger);
  cfAgo duplicates the engine's ago (the page cannot require the engine).

#### Iteration 2 (opus)
- WARNING fixed (W1): a bare 403 or "permission denied" no longer counts. A NOISE pass first records nothing for a rate
  limit, a quota, a missing or expired key or token, or a local file or SSH error. "403 Forbidden" and a bare
  "Forbidden" still count, after that pass. Weakest premise: a 403 Forbidden with no other words is a refused action
  more often than not.
- WARNING fixed (W2): not-offered only on the strong signals (unknown tool or method, method or tool not found,
  JSON-RPC -32601). "Operation/function not supported" and "unknown action" are how input errors read too, so they record
  nothing.
- WARNING fixed (W3): the scope errors real services send (Google's insufficient authentication scopes, Slack's
  missing_scope, GitHub's resource not accessible by, HubSpot's requires any of [...]), checked before permission.
  SAML enforcement is policy.
- WARNING fixed (W4): the store key carries the kind (kosmos:github, other:github), so a person's GitHub plugin and
  Kosmos's GitHub connection are two rows; ?service= still finds both by name.
- WARNING fixed (W5): the Mac CLI says a gate refusal (403 { error }) in the Windows words, "Kosmos refused that
  request: ...", for found and --found; both CLIs have a test for it.
- NITs fixed: a prototype-free store (a service named "constructor" works); C1 controls and direction marks stripped;
  the CLI says "seen on a refused call" and "everything tried works", as the page does; the Mac token check spells its
  letters; the browser-check controls start from a SHOWN box and repaint (the expiry path).
- NIT left: a server name containing "__" splits early (mcp__remote-devices__Claude_Browser__navigate files under
  remote-devices); it still names a real plugin.

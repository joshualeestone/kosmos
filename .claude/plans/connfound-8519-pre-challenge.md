---
pre_challenge: true
method: challenge-loop
branch: connfound-8519
diff_hash: a5f5e7d14774c97ca86e99f079b9fbb0c92ce17ddb5dfa9102d88306b1324eff
validation: passed
subdir_audit: passed
timestamp: 2026-11-14T16:58:09Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 raised no BLOCKER and the reviewer would merge; its two WARNINGs are fixed and pinned)
**Fixed:** every BLOCKER and WARNING of iterations 1 to 6 | **Asked:** 0

Iteration 3 found that the premise of the automatic path (sorting free error text) was wrong, so it was redesigned,
not narrowed again: the hook now records only an unknown-tool refusal that names the called action. The redesign and
the build-vs-design differences are posted on kosmos#8519.

Validation: `bash tools/run-tests.sh` on this branch.
- Run 1 (10:21 CST): red, 6 of 29089, all this branch's own guard misses, fixed in 2f6088ec9d.
- Run 2 (10:47 CST): 28564 pass, 1 fail: tools.shell-shard-4317 (#6791), which runs run-tests.sh, which ran the #2518
  surface gate. The gate refused render-cloud-signin-4903.js on the token 'asSentence', which this branch now uses
  inside the new Connections section (the agents' note). That check's sign-in screen is untouched, so the per-check
  trailer is on the commit that adds this proof. With it, the gate passes and that file passes alone (re-run after
  this commit). The same file passed 24 of 24 on origin/main, so the only cause was the gate.
- Also run: the card's own tests (engine, server, both CLIs, the guide), the touched pins, render-conn-found-8519.js
  (52 of 52), and the #1720 and #2518 gates.

### Per-Iteration Breakdown

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

#### Iteration 3 (opus): the premise was wrong, so the automatic path was redesigned
- BLOCKERs (B1, B2): sorting free error text kept mislabelling ordinary errors after two narrowing rounds ("Payment
  method not found", "tool not found in cache", "Method not found: tools/call", a transport 403 on a plugin's whole
  endpoint, an archived repository, GitHub abuse detection, a resource-level "not authorized to view this channel").
  Three rounds of false positives say the weakest premise ("the pattern sort is right often enough") is false, so the
  sorting was REMOVED rather than narrowed again. The hook now records exactly one outcome, not-offered, and only when
  the error line STARTS by saying the tool is unknown AND names the very action that was called. Permission, scope,
  policy and failed are recorded only by an agent, by hand. "No such tool available" (Claude Code's own) joins the
  local refusals.
- WARNING fixed (W1): a hand "works" clears an automatic finding for the same action in the other row of the same name
  (the hook files a GitHub plugin under other, an agent naming GitHub under Kosmos's own). Action names match
  whatever their case, spaces, underscores or hyphens; the guide says to name the action as the tool names it.
- WARNING fixed (W2): the guide calls a finding a hint: if the task needs an action listed as not working, try it once
  and record works if it does. An automatic finding is kept 7 days, a hand record 30.
- WARNING fixed (W3): an automatic finding never replaces a hand record.
- NITs fixed: --found <service> with nothing found names the service; the Mac prints a refusal on stderr, as Windows
  does; zero-width characters are stripped, and a note holding them around a key is refused by the redactor; the note
  is stored clean; the CLI test's times are whole days (no minute-boundary flake).
- NIT left: a note that is literally -h or --help is read as a help request by the Mac CLI's global help guard.
- Weakest premise now: that an MCP server's unknown-tool error starts with those words and names the tool. Servers that
  word it otherwise record nothing, which is the safe direction.

#### Iteration 4 (opus)
- WARNING fixed (W1): `kosmos connections found --outside ...` files a finding as a plugin of the person's own, even
  when its name is one Kosmos also connects (GitHub); before, a plugin's refusal recorded by hand landed under Kosmos's
  own connection and sent the person to the wrong place. Both CLIs, the server and the guide; tested on all three.
- WARNING fixed (W2): a hand-typed service name goes through the same tidying as a plugin's tool name (serverName:
  claude_ai_ and plugin_ dropped, a plugin's doubled name collapsed, underscores as spaces), so copying the server
  part of a tool name lands on the automatic row and clears it; the guide says to name the service as --found lists it.
- WARNING fixed (W3): the automatic rule also reads the TypeScript MCP SDK's "Tool X not found" and an "Error:" lead,
  still anchored end to end and still requiring the called action.
- NITs fixed: the note check runs on the cleaned text; at the service cap, services with only automatic findings go
  first (tested); only a plugin's doubled name collapses (foo_foo stays); the Windows plain listing waits 5 s for the
  extra read, as the Mac does; the run-together comment in server.js.
- NIT left: the browser check measures contrast on the not-working words and the who-and-when line, not on "Works"
  (it uses the same colour as the who-and-when line, which is measured).

#### Iteration 5 (opus, a final read of the whole branch)
- WARNING fixed (W1): the guide said a plugin's action is "the part after its last double underscore"; the code splits
  at the first. The guide now says to name the service and action as --found lists them, otherwise the tool name
  without its mcp__<server>__ start.
- WARNING fixed (W2): a hand record is filed as Kosmos's own connection only when that connection is set up here
  (held !== false); Discord, Notion or Linear never connected in Kosmos is a plugin's name. Pinned, with a control.
- WARNING fixed (W3): the two places the build differs from the card's design call (one section at the end of the tab,
  not a count per row; one summary line in the plain listing) are posted on the card with the reasons.
- NITs fixed: a full tool name in the error must be THIS server's; the per-service action cap keeps hand records
  before automatic ones; the summary line marks a plugin "(outside Kosmos)"; the guide asks agents to check before
  relying on a service, not before every action.
- NITs left: the automatic path may rarely fire in practice (Claude Code refuses unknown tools itself, which is
  excluded), the safe direction; a McpError: lead is not read; "in the last 30 days" also covers 7-day automatic
  findings; the Mac says "could not read" on stdout as its existing listing does.

#### Iteration 6 (opus, a final read of the whole branch; the reviewer would merge)
- WARNING fixed (W1): "set up here" is held === true. GitHub and Vercel report null when this computer is not signed in,
  and null passed the old check; the server test now proves both arms (a stored Cloudflare token files as Kosmos's;
  an unsigned-in GitHub files as outside).
- WARNING fixed (W2): service and action names go through the same key check as a note (they are shown on the page and
  in every agent's listing), and a name over the limit is refused instead of cut.
- NITs fixed: the copy no longer says "30 days" where automatic findings last 7 ("lately" on the page; "yet" in the
  empty CLI line); the Mac CLI passes its arguments to node after "--", so a name starting with "-" is an argument
  (tested, with a control on the previous script).
- NITs left: a finding dropped at a cap still returns ok; a hand works on Kosmos's connection also clears the plugin's
  automatic hint for that action (the safe direction, chosen on the card); a server name containing "__" splits early.
- Converged: round 6 raised no BLOCKER and its two WARNINGs are fixed and pinned.

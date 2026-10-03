# #5091: switching an agent TO Claude offers the Claude accounts, and the panel stops speaking for the old provider

## Measured first (Mortals, 22:12 CDT, the board itself)
- Josh's board runs 0.7.19 (installed package.json; the board process started 20:54), so #4963's Done-while-waking fix
  is in. GET /api/accounts: five Claude accounts (main, account-b, account-d, account-g connected; account-e signed out),
  every one memoryShared. So he could switch: Switch & Restart lands Liu Kang on the MAIN Claude account (the engine's
  "claude carries no account"), and the Move row then lists the Claude accounts. Told Splinter at 22:13.
- The defect: the switch picker (#d-provider-account) was hidden for Claude by design ("for a switch back to Anthropic
  there is nothing to pick", written when Claude meant one account), and the move row below kept speaking for the
  agent's CURRENT provider (Gemini's "no account to move it to", "Gemini picks its own model").

## Change
- engine/create.js setProvider: a switch to 'anthropic' may carry `accountDir`. Checked BEFORE anything is written with
  setAccount's two rules (the account exists here; it shares the agents' history), so a bad pick refuses and changes
  nothing; applied after the switch through setAccount itself (launch job and #1629's per-account trust), so Move and
  this cannot disagree. A setAccount refusal after the switch is PARTIAL and said. Returns `account` {dir, email, chosen}.
- server.js provider route: "it starts on your main Claude account" only when no account was picked; the account noun
  is "Claude account"; a PARTIAL's sentence is appended.
- web/index.html: fillSwitchAccounts treats Claude as a keyed target (list = Move's rule: memoryShared, not signed out,
  preselected on the main); the picker's label says "Claude account to run on"; the confirm dialog names the picked
  Claude account instead of "your main Claude account"; the CURRENT provider's block (#d-current-rows: account row, its
  line, model row) is hidden while a switch to another provider is armed, and back when the menu returns to it.

Rejected: only rewording the move row (Josh asked for the list of emails before the switch). Moving after the restart
in two steps (two restarts, and the agent first comes up on an account nobody chose).

Weakest premise: setAccount after setProvider rewrites the launch job a second time before the restart; the route
restarts once, after both. If setProvider's restart ever moved inside setProvider, the agent would start on the main
account and need a second restart.

## Measured (22:2x)
- engine/create.switch-claude-5091.test.js 5/5: none picked -> main (no pin); picked shared account -> CLAUDE_CONFIG_DIR
  in the launch job; main picked -> no pin; own-history and unknown -> REFUSED with the job and provider unchanged.
  Mutants red by name: the pick ignored; the pre-check removed.
- docs/browser-checks/render-switch-claude-5091.js: on main every substantive arm FAILS (no picker, the rows still
  shown, no account sent); on the branch 11/11 (picker label, main + account-b only, main preselected, current rows
  hidden and take no space, the dialog names b@example.com, the POST carries account .claude-b with picked:true, the
  rows come back on the agent's own provider, no page errors).
- Existing: 7 switch/provider test files 81/81; reason-grep (counts +1 each, measured) and README index; gated.txt +1
  (tools.browser-checks-wired 11/11, run from the repo root).

## Review
- Round 1: PENDING.

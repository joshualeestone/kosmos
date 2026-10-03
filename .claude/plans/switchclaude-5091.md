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
- Round 1 (opus, blind): 1 BLOCKER, 4 SHOULD-FIX, 5 NIT, all taken (22:5x). BLOCKER (measured): the hint under the new
  Claude picker said "Choose which OpenAI sign-in it runs on" (switchKeyedSay knew only OpenAI/Gemini/Grok), the very
  wrong-provider defect this card fixes; switchKeyedSay now speaks Claude for 'anthropic'. SF1: a PARTIAL (switched, but
  the picked account could not be applied) reached the page as 'changed' and the dialog said Ready; the route now answers
  'partial', leading with what happened, restart or not. SF2: after a successful switch the menu value is '' and the
  block stayed hidden (armed is true for ''); the block now hides only for a real other provider. SF3 (Josh's Liu Kang):
  an Antigravity/Muse agent's account picker returns early, so the block never came back on a reopen;
  paintProviderPicker now shows it synchronously. SF4: the check could not see SF1-3; it now reads the hint line, repaints
  the agent's own provider, checks the rows after the switch, and asserts picked:true. NITs: a refused Claude pick
  re-reads the list; the PARTIAL sentence has one "main", no doubled stop; the pre-check refusal reads straight; the markup
  comment and static label; the Claude pick is checked after "already runs on Claude", and picking the main is named back.
  Engine test +3 arms (8/8): PARTIAL via a list seam (asserts the seam was reached twice), the trust record lands in the
  picked account's .claude.json, the main named back. Browser check 13/13 on the branch; main fails every substantive arm.
  ⚠️ While stopping the superseded Mortals run, a broken remote tree-walk killed pid 48283; it was in no listing taken
  moments later (most likely the walk's own awk), not proven. Killing then went by an explicit printed tree.
- Round 2: PENDING.

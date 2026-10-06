# switchmodel-5429: switching an agent's provider picks the model in the same step

Josh, 2026-10-06 18:29: switching Gemini to Claude on an agent's AI Settings offered only the account and Switch & Restart, so the agent started on the default model and picking the model took a second restart.

Built:
- The switch row (Runs on) shows the TARGET provider's model menu beside its account, `#d-provider-model`:
  - to Claude: its models (create.js MODELS via /api/roles), the default preselected (the one the create form preselects);
  - to OpenAI: the chosen account's list (/api/accounts/openai/models), "Let OpenAI choose (recommended)" first, which sends no model; refilled when the account changes; hidden when the account cannot list (OpenAI picks);
  - hidden for Gemini, Grok, Antigravity (each picks its own model, or Kosmos pins one), and when the menu is on the agent's own provider.
  It is filled wherever the switch's account menu is (fillSwitchAccountsSafely), held disabled while a switch is in flight, and a generation guard drops an OpenAI list that arrives after the provider or account moved on.
- The switch request carries `model` when one is picked. The provider route checks it BEFORE writing anything (Claude: a Claude key in MODELS; OpenAI: the account's runnable list, failing open when it cannot be read, as the model route does; any other provider: refused, it picks its own), so a refused model leaves the agent as it was. After setProvider it writes the model with setModel to the switched job, then restarts ONCE.
- The confirm dialog and the route's answer name the picked model ("it starts on Claude Opus 5.5"); Runs on names it until the live reading catches up (plannedModelName from the answer).

Review 1 (fixed): every path of the menu sets `disabled` (a Claude menu shown after an OpenAI load in flight stayed greyed out and sent nothing); a refill for the same target (the account list arriving, a Claude account change) keeps the person's pick; opening another agent clears the menu (paintProviderPicker), so another agent's menu never stays; the route's OpenAI path has tests (refused, written into the Codex job, fail-open). Left: an OpenAI model is named by its id in the answer (setModel's label for a per-account model is its id); with no account sent the route checks the default account's list (the page always sends one); the restart-failed answer does not name the model.

Decided:
- The default is preselected and sent, as the create form does (the create form pins the default model too). Leaving the menu untouched therefore pins Claude Sonnet 5, where the old switch left the model empty (Claude's own default). Weakest premise: that pinning the create form's default is what the person wants; if Claude's own default should stay unpinned, a first "Claude's default" option with value "" would restore that.
- Gemini, Grok and Antigravity show no menu: Kosmos has no list of their models (the agent page says the same).
- Not in 0.7.26: Baron was cutting it at 18:35, before this was ready.

Weakest premise overall: that the OpenAI per-account list read on the page matches the one the route checks; both read openaiaccounts, and the route fails open.

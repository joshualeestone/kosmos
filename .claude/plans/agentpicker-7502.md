# agentpicker-7502: the phone's provider, account and model picker (kosmos#7502)

## Finished looks like

- Set up your agent on the phone offers the desktop's provider, account and model choice (cstep-name's
  `#create-provider` / `#create-account` / `#create-model`), from the board's own routes, in the desktop's words.
- The team step offers the same choice for the whole team (tc-provider / tc-account / tc-model).
- A swarm keeps Claude only: every other provider greyed with "Swarms run on Claude for now", as the desktop.
- Checked on the smallest phone (design shots).

## Slices

1. **Logic (this branch, first):** `ios/Kosmos/NewAgentPicker.swift`, a new file, pure and tested in the room runner.
   Ports, rule for rule: acctProvider, acctOfferableTarget, acctUnknownLive, acctPrimaryName, accountQualifiers
   (single-provider list, so providerDistinguishes is always false here), paintKeyedProviderOptions,
   paintAgyOption, paintMuseOption, the compat gate, fillCreateAccounts, resetCreateProvider's default,
   applyCreateProviderUI's three model rows, paintOpenaiCreateModel's states, openaiNoModelsNote, createPickGone's
   sentences, swarmProviderGate, and create-go's provider/account body rule.
2. **View:** wire it into NewAgentView's setup screen and the team step. Waits for Angel's agentpic-7488 (it rewrites
   the same Model row: "Model shows once"), so the view work goes on top of hers rather than beside it.

## Decided

- A new file, not more of NewAgentLogic.swift: Angel's open branch edits that file and NewAgentView.swift, and the
  logic does not need either. The one shared line is run-room.sh's file list.
- Qwen is gated by account only. The desktop also greys it on a Windows board; the phone cannot tell the board's
  OS, but Qwen connects only on a Mac, so a Windows board has no Qwen account to offer. Weakest premise of the slice:
  if a Qwen account ever exists on a Windows board, the phone offers it and the engine's refusal sentence is shown.
- DeepSeek: offered only when GET /api/accounts/compat says enabled with a deepseek vendor, and an account is usable.
  Same Windows caveat as Qwen (the engine refuses, the phone shows the sentence).
- The account row shows only at two or more usable accounts (Josh's #2097 ruling, quoted in web/index.html).

- The team step sends the provider always (the desktop's tcModel: its menu's value is never empty), the account and
  model only when there are some, and takes the choice once when making starts (the desktop's TC.model). Create waits
  while an OpenAI account's list is loading (tcIsModelLoading). The single create sends the provider only when it is
  not Claude, as create-go.
- The single and team screens share one choice on the phone (the desktop's team step copies the form's).

## Not verified

- Not run on a device or against a real board; no screenshots yet (they wait for the 0.7.73 cut to free the machine).

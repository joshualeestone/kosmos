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

## Review rounds (ledger)

1. opus: 2 BLOCKER, 3 MAJOR, 6 MINOR, all in the view's state (the pure rules matched the desktop).
   Fixed: the account is kept per provider and the OpenAI model per account, and an OpenAI model is sent only while
   that account's own list offers it (BLOCKER: a pick for account A went with account B); a team's choice is fixed
   from its first run and a late read changes nothing while the team is being made (BLOCKER, the desktop's
   tcChoiceFixed / TC.model); Create waits for the account list, or 5 s (tcFillProviderNow); a later read or visit
   keeps a pick still offered; a failed read keeps the last good answer; each read applies as it lands; the model
   rows hide their label again (Mona Lisa's ruling on #7488); a swarm keeps the agent's pick for the way back; the
   current provider is ticked in the menu; the footer shows both the undone pick's sentence and the row's note.
   Decided, not fixed: Moonshot Kimi and Mistral ("coming soon") are not listed on the phone, which offers what can be
   chosen; the Antigravity sign-in hint always shows (the desktop's FR_AGY_READY is set only by its first run); the
   team's OpenAI models read has no 25 s bound of its own (the client's request timeout applies).
2. sonnet: 1 MAJOR, 5 MINOR. Fixed: a team's choice is reused only once making has begun (a refused name check left
   it set, so the next press made the team on the old choice while the screen showed a new one); a cancelled account
   read is neither a failure nor settled; the models read counter moves only past its guards; a models read with no
   answer keeps the list held before, else says it could not reach OpenAI; choosing the same account again reads
   nothing. Decided: while a team is locked a late account list can change the account shown, never the one sent.
3. opus: 1 MAJOR, 2 MINOR, fixed. Traced a default-Claude single create and an OpenAI-only team to the request:
   both match the desktop. MAJOR: the untouched default did not settle on a swarm, so Swarm then Agent could make a
   Claude agent for an OpenAI-only person; it settles whatever the kind now (only a touched pick's undoing waits for
   the agent's screen). MINORs: one OpenAI models read per account at a time; a Qwen endpoint is named as JavaScript's
   URL host (default port dropped, IPv6 in brackets), tested.

## Not verified

- Not run on a device or against a real board; no screenshots yet (they wait for the 0.7.73 cut to free the machine).

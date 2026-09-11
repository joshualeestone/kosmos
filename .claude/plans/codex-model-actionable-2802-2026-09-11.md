# codex-model-actionable-2802: make the Codex model-disabled state actionable

**Card:** kosmos #2802 (Baron Draxum; unblocked by #2826)
**Branch:** codex-model-actionable-2802 (agent-workforce)

## The ask

Josh, testing 0.6.56: for an agent on a Codex / ChatGPT-subscription account, the
Model tab's selector is inert - "I can't even click to activate the model
selector". The panel shows "OpenAI picks its own model for now", a greyed "Change
& Restart", and the prose "This account is signed in with ChatGPT, so we cannot
list its models here... Sign in with an API key to choose a specific model." From
the user's side that reads as broken.

## The design call (option a, reaffirmed)

Two options were on the card: (a) make the disabled state clearly actionable, or
(b) allow a model choice on the subscription path. Option (b) is #2140 and rests
on an unresolved capability question - you genuinely cannot pick a model on a
ChatGPT subscription (OpenAI picks it). So the selector staying disabled is
correct; the fix is to give the state a real next step instead of only prose.

## The change (web/index.html only)

- Add a `#d-model-connect` button ("Connect an API key") after the model-tab
  note (`#d-model-msg`), hidden by default.
- `paintOpenaiDetailModel` hides it on every paint (a synchronous reset, so a
  prior agent's button cannot linger through the /v1/models round-trip) and, in
  the not-listable branch, shows it ONLY for the not-an-api-key (ChatGPT
  subscription) case (`/not an api key/i.test(because)`). A rejected or
  unreachable key has a different remedy and gets no Connect button.
- Wire its click to `openAcctAdd` - the same Add-a-provider flow the Accounts
  "+ Add a provider" door opens - so the user can connect an API-key account.

## Verification

- Extended `docs/browser-checks/render-detail-openai-model-2140.js` (which already
  drives `paintOpenaiDetailModel` against the real DOM with a stubbed fetch): in
  the NOT-LISTABLE case it now asserts the button shows and, on click, opens
  `#acct-add-modal`; in the LISTABLE case it asserts the button stays hidden.
  Green headless (connectShown/connectOpensFlow true, connectHidden true).
- Full web suite 1284/1284, browser-check guard tests (selectors/emit-count/
  indexed) green. No surface-map token hit.

## Decisions / rejected alternatives

- **Rejected: turning the note prose into a link** by changing `openaiNoModelsNote`
  to return HTML. That function is shared by the create form and detail surface,
  so a separate conditionally-shown button is cleaner and does not affect other
  callers.
- **Rejected: showing the button for every not-listable case.** A rejected/broken
  key (401/403/429) already has a key; its remedy is reconnect, not "connect an
  API key". Scoped to the not-an-api-key case, which is exactly Josh's scenario.
- **Weakest premise:** that opening the general Add-a-provider modal (rather than
  a pre-selected OpenAI-API-key path) is a good-enough next step. It is the honest
  action and reuses the proven flow; a pre-selected variant is a follow-up if the
  extra clicks prove annoying. This is a needs-browser card - a real-browser
  eyeball (Angel/Josh) confirms the UX beyond the headless behavioural check.

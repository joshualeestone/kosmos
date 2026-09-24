# One provider order: Claude, OpenAI, Gemini, Grok (kosmos#3651)

Josh, 2026-09-24 17:05, #admin: "i want to put Grok right under Gemini in all lists,
so it would be Claude/OpenAI/Gemini/Grok."

## Measured before building
- #d-provider, #create-provider, #acct-provider-pick: Claude, OpenAI, Gemini, then
  "Meta / Llama, coming soon", THEN Grok. Grok was the only one out of place.
- First-run provider rows: already Claude, GPT, Gemini, Grok.
- Settings account list: provider boxes in whatever order the server listed the
  accounts (first appearance), so a Grok key added before a Gemini key showed first.
- Usage (Token Usage by model and by agent) is ordered by share of tokens, which is
  data order, not a provider list; left alone on purpose.
- No shared order existed (no PROVIDER_ORDER).

## Change
- `PROVIDER_ORDER` (frozen): anthropic, openai, google, xai, then the coming-soon
  providers meta, alibaba, moonshot, mistral. `claude` aliases anthropic (the
  Add-a-provider picker's value). `providerRank()` reads it.
- `orderProviderOptions(id)` sorts a select's options by it (placeholder first, unknown
  values keep their place, selection kept). Run on all three pickers at startup, before
  `enhanceProviderSelect` builds their logo comboboxes, so the widget reads the order too.
- `accountGroupsHtml` sorts its provider boxes by it.
- The static HTML of the three selects is reordered to match, so the source reads the
  same as the screen.

## Verification
- docs/browser-checks/render-provider-order-3651.js (file://, 15 checks): the constant,
  each picker's options and its combobox, first-run, account boxes fed in reverse, and a
  CONTROL that shuffles #d-provider and shows orderProviderOptions restores it.
  Perturbations: old HTML with no startup sort reds the #d-provider arms; removing the
  account sort reds the account arm.
- web.provider-groups-1393.test.js lifts the new dependencies and gains an order test.
- Registered in tools/browser-checks.sh; reason-grep counts updated as measured.

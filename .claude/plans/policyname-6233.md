# policyname-6233: a policy refusal names the provider as the screen does (#6233)

## Finished looks like
Under a company policy, every refusal names the provider as the Add a provider menu does ("OpenAI", "Google Gemini"),
none prints an internal id ('openai', 'google'), and a test reds on the raw id.

## The call
engine/orgpolicy.js gets its own PROVIDER_NAMES map, used by all three refusal sentences (provider not allowed; only
some models; this model not allowed). These three are the only policy refusals that name a provider; every other
caller passes their `because` through. Names are the screen menus' words: Anthropic Claude, OpenAI, Google Gemini,
Google Gemini (Google subscription), xAI Grok, Meta Muse, Alibaba Qwen. An id not in the map reads "this provider".

## Rejected
- create.providerLabel: it returns 'Anthropic' for any id it does not know, so an unknown provider would be refused
  as Anthropic; and its words ("Gemini", "Grok", "Qwen") are shorter than the menus'. Changing it would move every
  other screen that uses it (board labels, project view), which this card does not ask for.

## Tests
engine/orgpolicy-names-6233.test.js: for every id, all three sentences say the screen name and not the id; unknown ids
(and an inherited key such as toString) read "this provider" and never a vendor; each name is the text of an
<option> row in web/index.html (a rename on either side reds). Measured: putting the raw id back, mapping unknown to
Anthropic, and drifting a name from the menu each fail it. Seven existing assertions that pinned the raw-id wording
(create, discover.adopt, orgpolicy-5534, register, worldstarts, server.switch-model-5429) now pin the names.

## Weakest premise
That the Add a provider menu is "the name the screen uses". The create menu says "Anthropic / Claude" and "OpenAI /
Codex" for the same two; the refusal follows the Add a provider menu, which names the vendor, as the card asks.

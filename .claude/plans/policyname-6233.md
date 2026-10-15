# policyname-6233: a policy refusal names the provider as the screen does (#6233)

## Finished looks like
Under a company policy, every refusal names the provider in the provider menus' words ("OpenAI", "Google Gemini (API key)"),
none prints an internal id ('openai', 'google'), and a test reds on the raw id.

## The call
engine/orgpolicy.js gets its own PROVIDER_NAMES map, used by all three refusal sentences (provider not allowed; only
some models; this model not allowed). These three are the only policy refusals that name a provider; every other
caller passes their `because` through. Names are the screen menus' words: Anthropic Claude, OpenAI, Google Gemini,
Google Gemini (API key) for google (the create menu's words; review 1), Google Gemini (Google subscription), xAI Grok, Meta Muse, Alibaba Qwen. An id not in the map reads "this provider".

## Rejected
- create.providerLabel: it returns 'Anthropic' for any id it does not know, so an unknown provider would be refused
  as Anthropic; and its words ("Gemini", "Grok", "Qwen") are shorter than the menus'. Changing it would move every
  other screen that uses it (board labels, project view), which this card does not ask for.

## Tests
engine/orgpolicy-names-6233.test.js: for every id, all three sentences say the screen name and not the id; unknown ids
(and an inherited key such as toString) read "this provider" and never a vendor; each name is the text of an
<option> row in web/index.html (a rename on either side reds). Measured: putting the raw id back, mapping unknown to
Anthropic, and drifting a name from the menu each fail it. 14 existing assertion lines in six files that pinned the raw-id wording (create 6, orgpolicy-5534 4,
discover.adopt, register, worldstarts, server.switch-model-5429 1 each) now pin the names.

## Weakest premise
That the menus' words are "the name the screen uses". Two menus name providers: the Add a provider menu (vendor names)
and the create menu ("Anthropic / Claude", "OpenAI / Codex", and two Gemini rows). The refusal uses the Add a provider
words, except google, which takes the create menu's "Google Gemini (API key)" so it is told apart from the
subscription row beside it (review 1). The test finds each name on some menu row, not on a particular menu.

## Review 1 (opus), and what changed
- google is "Google Gemini (API key)": "Google Gemini" alone read as a ban on all of Gemini beside the create menu's
  subscription row a policy may allow.
- The test reads every provider id createAgentInner accepts and asserts each has a name, so a new provider added to
  create.js but not to the map reds instead of quietly saying "this provider".
- The menu check is exact (a "coming soon" row allowed); header comment lists alibaba; plan count corrected.
- Not in scope, noted on the card: the model sentence still names the model by its key ("haiku"), not the picker's label.

## Review 2 (sonnet), and what changed
- Comment, plan and test title no longer say every name is the Add a provider menu's: google follows the create menu.
- The accept-list read takes ids with digits or hyphens too.

## Review 3 (opus): converged (nits only: two test comments, fixed).

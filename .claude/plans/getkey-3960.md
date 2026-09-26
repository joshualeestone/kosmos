# getkey-3960: a "Get a key" link beside every provider API-key box

Card #3960 (Josh, 2026-09-26 08:42: "we should probably put a link to that if people select a Gemini key so they know where to go to generate one").

## What finished looks like
Every place Kosmos asks for a provider's API key (Settings > AI Models > Add a provider: Gemini/Grok, OpenAI, Anthropic; first run: OpenAI, Gemini, Grok) shows a "Get a key" link that opens that provider's key page in the browser, all read from ONE table, with the addresses checked live. Served build with a shot of each key box.

## Decided
- One table `KEY_PAGES` in web/index.html (google, xai, openai, claude) and `keyPageLink(el, provider)`. Every link carries `data-keypage` and is set at load; the Settings Gemini/Grok box is shared, so its link is set in `acctApikeyShow` from the picked provider. The first-run buttons that already existed now read the table (Grok's pointed at the console's front page; it now points at the key page).
- Addresses (checked live 2026-09-26, recorded on the card): Google `aistudio.google.com/apikey` (sign-in, then the page); xAI `console.x.ai/team/default/api-keys` (what xAI's docs link); OpenAI `platform.openai.com/api-keys`; Anthropic `platform.claude.com/settings/keys` (the old console address forwards there, so the final one is used). OpenAI's and xAI's answer scripts with a bot check, so they were taken from the providers' own docs. Weakest premise: those two could not be fetched by a script.
- Settings style: #2234's quiet help link (`.acct-help a.btn-quiet`), with "(opens the key page in your browser)" for screen readers; first run keeps its existing Get a key buttons.
- Tests: web.getkey-3960.test.js (the table; every key box has its link in the same step; no key-page address anywhere but the table; the applier; the shared box's wiring). render-accounts-openai asserts the Settings OpenAI and Gemini links in a real page.
- Windows: the same page ships; Homer confirms on the card.

## Review round 1
- The shared Gemini/Grok link is now asserted in a real page to follow the pick (Grok -> xAI's page, not Google's), and the Anthropic link is asserted in render-claude-connect-choice-2433.
- The #3960 block sits above the #2338/#3566 comments, so those still describe the code under them.
- Screen-reader text names the provider ("opens Google's key page in your browser"); the first-run buttons carry it too.
- Tests pin all four addresses and scan for every provider's key-page domain outside the table.
- Accepted: the first-run buttons ship `href="#"` until the page script sets them (a page whose script failed is already broken); a literal fallback would be a second copy of the table.

## Review round 2
- BLOCKER fixed: render-openai-key-step compared the whole button text to "Get a key", and the new screen-reader span made it "Get a key (opens ...)". That check is not in gated.txt (it takes a board URL and runs outside the PR gate), so CI would have stayed green and a later run would have gone red. It now reads the visible words only and also checks the address against KEY_PAGES.openai. Not run here: it needs a board serving this branch at a URL, and the local board serves main; fixed by reading and syntax-checked. The sweep for other exact "Get a key" readers found none (web tests 1796/1796).
- The surface headers of render-openai-key-step and render-claude-connect-choice-2433 name the new getkey ids.

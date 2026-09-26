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

## Review round 3
- render-firstrun-keyed-connect-3658's surface header names fr-gemini-getkey and fr-grok-getkey; the render-openai-key-step README row says what it now checks.
- render-openai-key-step requires the table address (no silent pass when KEY_PAGES is unreadable); the Grok arm also checks the screen-reader text says xAI.
- The six links use rel="noreferrer noopener" (the board's address is not sent to the provider), as the page's external-site links do (plus-site-link, newsbar-link); the dialog's two older neighbours still use noopener only.
- The outside-the-table scan uses key-page paths where the domain has other legitimate pages.

## Review round 4
- render-accounts-openai carries a Browser-check-surface header naming acct-openai-getkey and acct-apikey-getkey, so a future change to those links is tied to the check that pins the shared box's switch.
- Recorded, not changed: render-accounts-openai and render-openai-key-step are not in gated.txt, so CI does not run them; both were run locally (the first passes via tools/browser-checks.sh; the second needs a board URL and is fixed by reading).

## Review round 5
- A test pins that KEY_PAGE_WHO and KEY_PAGES name the same providers (a new provider added to one only would have read "opens undefined's key page").
- keyPageLink resets the screen-reader text when it hides a link; the outside-the-table test is named for what it scans (the page).

## Review rounds 6 to 8
- Round 6 (sonnet): 0 BLOCKER. The first-run keyed check's README row did not say what #3960 added to it: fixed (9133a2331). The xAI key address's "default" team slug is this plan's stated weakest premise and stands (xAI's console blocks automated fetches, so it cannot be verified from here); Josh or QA can eyeball it once on a real xAI account. The first-run buttons' href="#" until the script runs is the round 1 decision and stands.
- Round 7 (opus): 0 BLOCKER. The first-run check matched only the host, so the old console.x.ai front page (the thing this card fixes) would still pass: it now requires href === KEY_PAGES[provider] for Gemini and Grok, and GPT's first-run link got its own real-page assertion (f104007e7; render-firstrun-keyed-connect-3658 passes). The unit test checks a hidden link drops the provider it named; a README full stop.
- Round 8 (sonnet): 0 BLOCKER, 0 code findings; this plan section was missing (added here).

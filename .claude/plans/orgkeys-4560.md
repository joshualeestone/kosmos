# orgkeys-4560: Kano's #4560 branch, continued (Ice Cream Kitty, night shift 2026-10-03)

The design, the provider table, Liu Kang's rulings and the weakest parts are Kano's, unchanged, in
`.claude/plans/orgchart-keys-4560-20260929T2305.md` (kept as written). This file covers only the continuation.

## What this branch is
- Kano's `orgchart-keys-4560` at 2e9c74d38 (challenge loop iteration 13, 2026-09-29), untouched on origin.
- Plus a merge of origin/main (645 commits newer). One conflict, CLAUDE.md, two rows: main had changed the
  Community feed row and the branch the org chart row, each side only its own, so the merge takes main's
  Community row and the branch's org chart row (checked against the merge base, row by row).
- No other change at the merge. The org chart unit tests pass on the merged tree (orgchartkeys 27, orgchartfile 51,
  server.orgchart-read-4559 18) and the page's inline scripts parse. That is NOT validation: the page change
  (the consent sentence and the reading message, which render-orgchart-file-4559 pins) has not had its browser
  check run on the merged tree, and that is the main open risk after 645 merged commits.

## Changed in the continuation (round 1)
- Key reads stop at 110 s, was 300 s: a read from a phone goes through the Kosmos+ relay, which gives up after
  120 s with no answer (kosmos-relay crates/tunnel/src/proxy.rs BOARD_RESPONSE_HEAD_TIMEOUT), so a longer read
  was billed to the key and seen by nobody. The Claude read already stops at 120 s. The page now says "up to two
  minutes" instead of "a few minutes". Rejected: a longer limit only for local reads (the board would have to
  tell a relayed request apart). Round 2: the Claude read's 120 s was EQUAL to the relay's, not under it (my
  round-1 comment said otherwise), so it stops at 110 s too. Both are pinned under 120 s by one test.
- The model ids were checked against the providers' live docs on 2026-10-03: gpt-6-astra (text and image in,
  128,000 output tokens; PDF through the PDF guide) and grok-4.7 (text and image in, structured outputs) are
  current. Not checked: that xAI's Responses API accepts `store` and `max_output_tokens`.

## Deferred, with reasons
- The reader is the first key account in Settings order even when its key no longer works (an expired default
  OpenAI key keeps winning over a working Grok key, and every read fails with "did not accept this key"). Choosing
  by the last check would need a live check per provider at pick time (none is stored). The person's way out is
  to remove or fix the dead key in Settings, AI Models, which the failure sentence already points to.
- `keyTail` is taken from the untrimmed key in openaiaccounts' identityFromData (main's code, also used by
  Settings), so a key saved with a trailing newline shows the wrong last four on the consent line. The reader id
  stays consistent. Outside this card.
- `invalid_request_error` in KNOWN_CODES can show as jargon in a refusal. Cosmetic, carries no key.
- The consent line says the read is billed to the key but gives no cost (round 2). Kosmos cannot promise a figure:
  it depends on the model's price and the chart. Josh-facing copy; left as is.
- A provider error code `not_found` gets the "this key cannot use <model>" sentence even when an endpoint moved
  (round 2). A wrong diagnosis, never a leak; the log line carries the status for whoever looks.
- xAI may answer a bad key with HTTP 400 and a flat body, which would read as the generic "could not read the
  chart (400)" rather than "did not accept this key" (round 2, from the reviewer's memory, unverified, no key spent
  to check). Joins Kano's first-real-read QA item.

## Why continue rather than restart
The work is done to iteration 13 and its design was ruled on by Liu Kang. It has sat four days with no PR. A new
branch leaves Kano's intact; if Kano is still on it, this stops.

## What is left
1. Fresh blind challenge rounds on the merged tree, until a round adds nothing new (main moved under the
   branch: account modules, server.js and web/index.html all changed since 09-29).
2. A proof for this branch name.
3. Full validation, and the browser checks for the web/index.html change (render-orgchart-file-4559 and the
   surface gate), on Mortals or after 07:00 (the Agent1s queue is day-one only until then).
4. A PR. After Monday; not day-one.

## Weakest premise (mine, on top of Kano's)
That nothing merged since 09-29 changed what this code relies on in a way the tests cannot see: the account
modules' `readApiKey` and account order, the consent route, and the pinned model ids (gpt-6-astra,
gemini-3.8-flash, grok-4.7). The tests pass, but they fake the HTTP call, so a retired model id or a renamed
account field that the fakes mirror would still pass. The first real read with each provider stays a QA item, as
Kano's plan says.

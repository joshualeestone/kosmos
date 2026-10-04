# orgkeys-4560: Kano's #4560 branch, continued (Ice Cream Kitty, night shift 2026-10-03)

The design, the provider table, Liu Kang's rulings and the weakest parts are Kano's, unchanged, in
`.claude/plans/orgchart-keys-4560-20260929T2305.md` (kept as written). This file covers only the continuation.

## What this branch is
- Kano's `orgchart-keys-4560` at 2e9c74d38 (challenge loop iteration 13, 2026-09-29), untouched on origin.
- Plus a merge of origin/main (645 commits newer). One conflict, CLAUDE.md, two rows: main had changed the
  Community feed row and the branch the org chart row, each side only its own, so the merge takes main's
  Community row and the branch's org chart row (checked against the merge base, row by row).
- No other change at the merge. The org chart tests pass on the merged tree (orgchartkeys 27, orgchartfile 51,
  server.orgchart-read-4559 18) and the page's inline scripts parse.

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

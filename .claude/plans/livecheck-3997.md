# livecheck-3997: every signed-in account can turn green, one colour vocabulary (kosmos#3997)

Card: joshualeestone/kosmos#3997. Josh, 2026-09-26 11:24: "only some of these that are signed in are actually green".
Design and measurements are on the card (comment 5849157780).

## What changes
- engine/grokaccounts.js `subscriptionLive(dir)`: a FREE check of a Grok subscription, only with a key that has not
  expired (the models listing grok itself reads; measured 200 real / 401 garbage). Kosmos never renews a key.
- server.js /api/accounts: Grok subscription rows are checked on the (person-paced) read; `live` is recorded on the
  dir like an observed request, so the existing overlay greens it; anything else stays signed_in_unverified with the
  check's reason. ChatGPT sign-ins: a cold cached handshake (codexsigninlive, free) is STARTED without waiting (#1921)
  and the row carries `liveCheckPending`.
- server.js POST /api/accounts/openai/check and /api/accounts/grok/check: free Check now.
- web/index.html: amber `.acct-unverified` for every unconfirmed sign-in; `.acct-none` (a confirmed negative) moves
  to --danger red; grey `.acct-unknown` is only "could not check". The ChatGPT row shows its check's verdict (green /
  red / amber). Check now on ChatGPT and Grok subscription rows. One follow-up read when a check is under way.

## Decided
- Pill text stays a short "Signed in" (Josh 6.68, #3136); the reason is in the title.
- A 401 from Grok is "not confirmed" (amber), never red: grok may renew the key on its next run.
- No timer: /api/accounts is person-paced by design.
- Claude: no free check measured, so its Check now stays the paid `claude -p`; follow-up.

## Rejected
- Running `grok models` to renew an expired key (it rotates the refresh token under a running grok; #3391 rules it out).
- Awaiting the ChatGPT handshake in the read (#1921).
- Codex `GET /wham/usage` instead of the existing handshake: the handshake is already the tested check.

## Weakest premise
- The Grok models URL is the CLI's own route, not a public API. If it moves, the answer is `unknown`: amber, never red.

## Tests (each perturbed red)
- engine/grokaccounts.livecheck-3997.test.js: live / refused / expired (never sent) / unknown.
- server.livecheck-3997.test.js: ChatGPT check started on open without waiting, pending, then green; Grok current
  key green, expired key unverified with reason and never sent; Check now routes (connected / none / unknown, kind 404).
- docs/browser-checks/render-account-badge-1921.js: amber class and free Check now per row; one follow-up read that
  turns a pending row green, never a loop, and none without a pending row (control).
- web.badge-observed-1921.test.js, web.openai-row-2568.test.js updated to the new vocabulary.

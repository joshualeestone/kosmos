# livecheck-3997: every signed-in account can turn green, one colour vocabulary (kosmos#3997)

Card: joshualeestone/kosmos#3997. Josh, 2026-09-26 11:24: "only some of these that are signed in are actually green".
Design and measurements are on the card (comment 5849157780).

## What changes
- engine/grokaccounts.js `subscriptionLive(dir)`: a FREE check of a Grok subscription, only with a key that has not
  expired (the models listing grok itself reads; measured 200 real / 401 garbage). Kosmos never renews a key.
- server.js /api/accounts: Grok subscription rows are checked on the (person-paced) read; `live` is recorded on the
  dir like an observed request, so the existing overlay greens it; anything else stays signed_in_unverified with the
  check's reason. ChatGPT sign-ins: a cold cached handshake (codexsigninlive, free) is STARTED without waiting (#1921)
  and the row carries `liveCheckPending` while it runs.
- server.js POST /api/accounts/openai/check and /api/accounts/grok/check: free Check now.
- web/index.html: amber `.acct-unverified` for every unconfirmed sign-in; `.acct-none` (a confirmed negative) moves
  to --danger red; grey `.acct-unknown` is only "could not check". The ChatGPT row shows its check's verdict (green /
  red / amber). Check now on ChatGPT and Grok subscription rows. Bounded follow-up reads while a check is under way, never under the person's hands.

## Review round 1 (Sonnet), what changed
- Grok REFUSING a sign-in (401/403) in this read outranks an earlier Check now green; no answer, or a key that
  expired as keys do, does not (neither is evidence against the green). Agent observations still count. Tested.
- The follow-up reads continue every 3.5s while a ChatGPT check is still pending, up to ACCT_FOLLOWUP.max (6), since
  a dead or slow handshake takes up to about 20s; a single read at 3.5s missed exactly that case. Tested: keeps
  reading until it can say, stops at the bound.
- NITs: codexsigninlive required once at the top of server.js; the .acct-none comment names --danger; the Grok title
  is gated on the subscription kind too; the badge check's "Claude-only" comment names the new field.

## Review round 2 (Opus), what changed
- BLOCKER (mine, from round 1): a ChatGPT check that finished WITHOUT an answer still read as cold, so the row said
  "checking" forever and the page re-read six times. codexsigninlive.checkState (fresh / running / cold): pending
  only while one is running. Tested with a runner that returns no report.
- Follow-ups never rebuild the list while a Check now is in flight, a Disconnect or Delete is half-pressed, or focus
  is in the list; they wait a turn, still bounded. (Tested through the in-flight arm; the list is off screen in the
  check, so focus cannot be placed there.)
- Grok checks start beside the other providers' checks, and concurrent reads share one request per folder.
- Check now is not offered on a lapsed or unreadable Grok sign-in; an expired key's title does not point at it, and
  its answer says "Not until Grok runs again". A refusal is its own answer: the page repaints, and the refusal
  forgets an earlier Check now green so a later read cannot bring it back (observed.forgetDir).
- ChatGPT Check now asks afresh (codexsigninlive.invalidate), never a cached answer from before a new sign-in.
- Stale comments corrected (grokaccounts, openaiaccounts, codexsigninlive, the page's #2568 and Check now notes, the
  badge check, server.js).
- Deferred: a Grok row greened by the free check (or Claude's Check now) shows the observed-request title ("an
  observed outcome, not a probe"); the check writes the same dir store as Claude's #3136 Check now, which has the
  same wording. Fixing the title for both needs the store to carry where a result came from: follow-up.

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
- docs/browser-checks/render-account-badge-1921.js: amber class and free Check now per row; follow-up reads until a
  pending row can say (then green), stopping at the bound, none without a pending row (control), none while a Check
  now is in flight; Check now's expired and connected answers.
- web.badge-observed-1921.test.js, web.openai-row-2568.test.js updated to the new vocabulary.

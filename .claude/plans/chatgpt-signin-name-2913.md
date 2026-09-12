# Plan: #2913 Remove the name field from ChatGPT-subscription sign-in

## Source

Josh, 6.59 QA (fresh install), 2026-09-12: "When signing in with a ChatGPT
subscription let's remove the option to add a name as part of that and remove the
copy that says the name is optional. It is only so you can tell this account apart
from another one later because we automatically pull in their email address for
that account. Just extra stuff that we're trying to get a user to fill out for no
reason."

## Scope

Subscription (Sign in with ChatGPT) sign-in ONLY. The API-key steps (Anthropic key,
OpenAI key) KEEP their name field: a pasted key carries no email to pull in, so the
name is the only way to tell two key accounts apart there.

Two subscription surfaces both have the field and both are changed for parity:
- Settings add flow: `#acct-openai-sub-step` (web/index.html ~8891)
- First-run install: `#fr-openai-sub-step` (web/index.html ~9634)

## Change

- Remove the name `<input>` (`#acct-openai-sub-label` / `#fr-openai-sub-label`) and the
  "The name is optional…" `<p class="dhint">` from both subscription steps. Keep the
  "Sign in with ChatGPT" button.
- JS: drop the now-dead label plumbing. The subscription/start POST no longer sends a
  `label`; the success message falls back to the account's email
  (`acctOpenaiSubConnected`). Both handlers already guarded a null field, so no engine
  change is needed -- `startChatgptLogin({ label })` treats an absent label exactly as
  it treated a blank name before (an already-supported path).

## Why no engine change

`server.js` /api/accounts/openai/subscription/start reads `body.label` (optional) and
passes it to `openaiaccounts.startChatgptLogin({ label })`, which resolves a fresh dir
via `resolveFreshChatgptDir(label)`. An absent label was always valid (the field could
be left blank), so removing the field is behavior-equivalent to a user never typing a
name; the email becomes the account discriminator, exactly as the card asks.

## Test

New hermetic browser check `docs/browser-checks/render-chatgpt-signin-no-name-2913.js`:
loads web/index.html over file://, asserts neither subscription step has a name input
or "name is optional" copy, that both Sign-in buttons remain, and -- as a control that
the removal is surgical -- that the Anthropic API-key name field (`#acct-claude-key-label`)
is untouched. Verified: REDS on origin/main (4 failures -- both labels + both copies
present), GREEN on this branch.

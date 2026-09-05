# provider-remove-2264: Delete and remove a connection + one bar-separated row

## Ask (Josh, 2026-09-05, PRIORITY)

Under Model Providers, add the ability to DELETE AND REMOVE a connection (not
just disconnect it): a connection to someone else's account he no longer wants
to SEE in the list at all, credential and all. And put the three actions on ONE
bar-separated row (Sign in again | Disconnect | Delete and remove) so stacked
single links stop pushing the page down.

## What Disconnect does today vs what Delete adds

Disconnect (forgetAccount) RENAMES the account dir to `.removed-*`, which drops
it from `list()` but PRESERVES the credential (the success message even says
"nothing was deleted"). Delete-and-remove (removeAccount) DELETES the dir, so
the sign-in is gone from this computer. That is the new capability Josh wants.

## Reversible semantics call (documented)

Delete is GATED the same way Disconnect is (#1659): if agents are running on the
account, it REFUSES with "stop the agents first" rather than auto-killing them
(auto-stopping agents is a bigger, more surprising action than Josh asked for).
Josh's use case (a connection to someone else's account) is the no-agents case,
so it just removes.

## Implementation

- Engine (both providers): `removeAccount(dir, usedBy)` = every guard
  forgetAccount has (same-home + name shape, running-agents gate NAMED, the
  identityOf guard so a name-shaped non-account is never rm'd), plus the DEFAULT
  is refused. Claude's default is unconditionally `~/.claude` (`base==='.claude'`
  == the resolved default). OpenAI's default follows CODEX_HOME/
  AGENT_WORKFORCE_CODEX_HOME, so it refuses `clean === path.resolve(defaultDir())`
  (env-aware, NOT a basename check - the review caught a basename version that
  would delete a moved default). Only the final step differs from forget:
  rmSync instead of renameSync. Irreversible; the UI asks with a confirm.
- Route: DELETE /api/accounts/<provider> takes `remove:true` and calls
  removeAccount instead of forgetAccount, AFTER the same fail-closed agents
  enumeration (a delete is at least as dangerous as a rename, so an unreadable
  fleet must not permit it). The answer says "deleted ... sign-in file is gone".
- UI: a "Delete and remove" button on every NON-default row of both providers
  (the default gets none, matching its disabled Disconnect); `.acct-actions` is
  a flex row with a left-bar (--k-rule) separator on each action after the
  first, so 2- and 3-action rows both read cleanly. The removal click handler is
  generalised to bind [data-remove] too, sharing the arm-in-place confirm /
  provider guard / a11y with Disconnect; only the confirm wording ("Delete for
  good?") and the body's remove flag differ, both read off the button.

## Verification

- Engine removeAccount tests (both providers): default refusal (incl. the
  env-moved OpenAI default), running-agents gate NAMED, identity guard on a
  name-shaped non-account, path-outside-home, already-gone quiet success, and
  the actual deletion (dir gone, no `.removed-*` leftover).
- Route tests: remove:true deletes (Claude + OpenAI), without-remove disconnects.
- 134+ account-suite tests green; selector/reason-grep root tests unaffected.
- Browser check: render-accounts-openai.js asserts the default has no
  Delete-and-remove, the non-default has a live one, and every rendered one is
  wired+labelled. The full browser harness is run before merge (paused during a
  launch-cut browser-quiet window; re-run on CLEAR).

## Related

#1659 (disconnect gating), #1372 (openai disconnect), #1922/#1917/#793 (sign-in
and identity follow-ups, not in this scope).

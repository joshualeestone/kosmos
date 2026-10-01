# #4844: one agent's revoke or sweep keeps another agent's tokens under a shared key

Card: joshualeestone/kosmos#4844 (claimed:angel, night shift; filed from #4792's residuals). Branch revokename-4844,
STACKED on tokenname-4792 (PR #4841): it needs the name #4792 records on each token. Rebase onto main after #4841.

## What finished looks like
Removing, recreating or sweeping agent "Mara" never cuts off agent "mara" when both hold named tokens in the shared
file, and a removed agent's tokens are never left alive by a spelling mismatch.

## The change (engine/sendertoken.js)
- othersTokens(held, name): a predicate for the tokens that are NOT this agent's, or null for "take them all". It
  narrows only when the file holds named tokens for two or more names AND one of them is exactly `name`.
- revoke(name): with a predicate, rewrite the file keeping the other names' named tokens (unlink if none left);
  otherwise unlink the whole file, as before. Still under the session lock (#1782).
- retireLauncher(..., { untagged: true }): the untagged sweep also keeps the other names' named tokens.

## Decisions
1. Narrow only on an exact name among two or more. Rejected: always narrowing to the given name. revoke is the
   new-agent security gate (create.js, #1782) and the removal path; a caller passing a spelling the mint did not use
   would then leave a removed agent's tokens alive. Taking everything on doubt is today's behaviour and fails closed.
2. Tokens with no name (minted before #4792) are taken as before: they cannot be attributed.
WEAKEST PREMISE: that every revoke caller passes the same spelling mint used. If one does not, the fallback takes
everything (today's behaviour), so the cost is the old over-revoke, never an under-revoke.

## Tests (engine/sendertoken.test.js)
- Revoking one of two names keeps the other's tokens, drops the revoked agent's and the unattributable older token;
  revoking the last name removes the file (control).
- A revoke by a spelling no token carries takes every token; with one name only, any spelling takes the whole key.
- One name's untagged sweep keeps the other name's untagged token and still takes its own.
- Mutants: never narrowing (2 red); narrowing on an unknown spelling (1 red).
- With the revoke callers' tests (remove, create, delete-leftover, supervisor retire, win32create) and the #4796
  guard: 404/404.

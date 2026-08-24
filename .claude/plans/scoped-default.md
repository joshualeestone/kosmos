# The scoped check answers for the default account too (#527)

## What finished looks like

subscription.check({configDir}) pointed at the DEFAULT account directory
(~/.claude) reads the default account's real record (~/.claude.json, one
level up, where accounts.configFile says it lives) instead of a file that
does not exist, so a future caller cannot be told "nobody has signed in to
this account yet" on a signed-in machine. Found by #324's bounded review
(iteration 3 NOTE); no current caller can reach it, which is why it is a
small card and not a hotfix.

## Changes

- engine/accounts.js: export configFile, the ONE answer for "where does
  this account directory keep its record" (the default's sits beside the
  directory, not inside it). Same one-answer rule as create.NAME_RE.
- engine/subscription.js: the scoped arm resolves its file through
  accounts.configFile instead of joining the path itself. The global arm
  (no configDir) is untouched, byte for byte.

## Review bound, stated before the loop

One blind iteration. A finding inside this change is fixed with a pin;
anything out of its reach is carded. The change is three lines on a pure
read path.

## Verify

- A scoped check at the default dir on a connected sandbox answers
  connected; at a fresh work dir it still answers none; the global arm
  unchanged. Full suite green, exit codes read from files.

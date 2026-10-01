# #4844: one agent's untagged sweep keeps another agent's tokens under a shared key; revoke stays whole-key

Card: joshualeestone/kosmos#4844 (claimed:angel, night shift; filed from #4792's residuals). Branch revokename-4844,
STACKED on tokenname-4792 (PR #4841): it needs the name #4792 records on each token. Rebase onto main after #4841.

## What finished looks like
A supervisor's untagged sweep for agent "Mara" never takes agent "mara"'s named tokens from the shared file, and a
removed or recreated agent can never keep a working token (revoke unchanged: whole-key).

## The change (engine/sendertoken.js)
- othersTokens(held, name): a predicate for the tokens that are NOT this agent's, or null for "take them all". It
  narrows only when the file holds named tokens for two or more names AND one of them is exactly `name`. Tokens
  with no name (before #4792) are taken as before.
- retireLauncher(..., { untagged: true }): the untagged sweep keeps the other names' named tokens.
- revoke: unchanged, whole-key, with a comment saying why it must stay so.

## Decisions
1. revoke stays whole-key (the card asked for both; half is rejected). Review 1 measured why narrowing it is unsafe:
   a paneless (Windows or remote) agent is listed, removed and created under its KEY spelling while its tokens carry
   the typed name, so a narrowed revoke kept the removed agent's own tokens and revoked a bystander's (#1782's
   hazard). Whole-key costs an over-revoke the other agent recovers from (relaunch, or re-issue), never an
   under-revoke.
2. The sweep may narrow because its name comes from the supervisor's token_roster_name, the same function that
   names its mint, so the spelling always matches.
WEAKEST PREMISE: that the sweep's caller and the mint always share token_roster_name. They do today (both in
bin/agent-supervisor.sh); a future caller that sweeps under another spelling would only fail to narrow (the old
behaviour), since narrowing needs an exact name match among two or more.
Not changed: mint's MAX_LIVE cap is per file, so one name's restart loop can still evict the other name's tokens.
Residual: an agent renamed only by case (adopted as "mara", relaunched as "Mara") keeps its old "mara"-named adopt
tokens through "Mara"'s sweep. They cannot resolve while "Mara" holds tokens (a clash, and pane rows match exactly);
after that they can resolve by key through a paneless or never-run row. Low likelihood; revoke on removal takes them.

## Tests (engine/sendertoken.test.js)
- One name's untagged sweep keeps the other name's untagged token and still takes its own.
- The sweep still takes an unnamed older token beside two names (the other name's kept), and a sweep by a spelling
  no token carries takes every untagged token.
- revoke by the KEY spelling (how a paneless agent is removed) and by the typed spelling both take every token.
- Mutants (review 3, on copies): no narrowing (2 red); the unnamed guard dropped (1 red); the absent-spelling arm
  dropped (1 red); the narrowed revoke put back (1 red).
- With the revoke callers' tests (remove, create, delete-leftover, supervisor retire, win32create) and the #4796
  guard: 404/404.

## Trade-off accepted
An untagged token from adopt, for a different-spelling agent that vanished without a revoke, used to be cleaned up
by the other name's sweep; now it stays until MAX_LIVE pushes it out or a create or revoke on the key takes it. It
can only resolve through a pane row with exactly that name, or a key row while no clash exists.

## Review
Round 1 (blind): BLOCKER, the narrowed revoke (above), reproduced by the reviewer in a sandboxed store. Taken by
removing it. The reviewer confirmed the -discord twin and the lock are unaffected.
Round 2 (blind): no blocker, two should-fix, both taken. The unnamed-token arm of the predicate had no test (a
mutant dropping it survived): a test now sweeps an unnamed older token beside two names and checks it goes while
the other name's stays. A stale comment said the sweep follows revoke's rule; it now says revoke does not narrow.
Nits taken: the absent-spelling arm is tested; retireLauncher's doc names #4844; the case-rename residual above.
Round 3 (blind): no blocker, no should-fix. CONVERGED. Nits taken: the size<2 arm is a short-cut (said in the
comment), "Windows create" corrected to adopt for a Mac store, the Tests section brought current; the reviewer's
trade-off recorded above.

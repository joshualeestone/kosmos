# tokenkey-4738: a stranger's unkeyable session name no longer breaks every agent's token (kosmos#4738)

## Problem (Angel's measurements on the card)
sendertoken.resolve found the token's row with store.safeKey(a.sessionName) === key && a.isNamedOurs, so it keyed every
row before checking whose it was. safeKey throws for a punctuation-only name ("!!", "@@", "~~"), which sorts ahead of
agents' names in the board's roster: one such tmux session made every agent's reply/report/msg/post/task verbs fail
with "invalid agent name".

## Call
Check isNamedOurs first, and key the name inside a try: a name that cannot be keyed is not this agent. One predicate.

## Test
engine/sendertoken.test.js: a real fixture roster (fleet.install with a stranger '!!' and agent 'mara'), '!!' sorted
first as the board sorts it; mara's token resolves. CONTROLS: '!!' is really first, and safeKey('!!') really throws.
Mutation (the old predicate) reds it with "invalid agent name".

## Weakest premise
That no caller relied on resolve throwing for an unkeyable name (it now returns the ordinary no-match answer). A throw
there was never a documented answer, and every handler Angel read caught it as a 400.

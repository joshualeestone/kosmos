# tokenclash-4763: two agent names with one safeKey cannot resolve each other's token

Card: joshualeestone/kosmos#4763 (found by #4738's review). store.safeKey is lossy (case and punctuation
folded), so "Mara" and "mara" share a key and ONE token file; sendertoken.resolve took the FIRST roster
row with that key, so with both running, one agent's token could speak as the other.

## Fix
resolve counts the roster rows of ours that share the key; with more than one it resolves NO agent
(NO_MATCH, the same answer as a token never issued). Creation's own key-clash refusal stays; this covers
the clash it cannot see (one stopped when the other was made; a session made outside Kosmos).

## Test (engine/sendertoken.test.js)
Mara and mara both ours: neither token resolves (controls: the names share a key; both rows are ours).
Control: with one running, its token resolves to it. Red on main's resolve (checked by swapping the file).

## Weakest premise
Refusing both is the safe answer but a denial for the agents involved: both lose their token until one
is stopped or renamed. Chosen over "guess by instance" because a wrong guess is token confusion.

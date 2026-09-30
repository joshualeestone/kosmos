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

## Review 1 (sonnet, blind, on e743aff8f), 17:23 CDT: no BLOCKER, 2 WARNINGs, 2 NITs
- WARNING, taken: a clash refused by `resolve` fell through to resolveAgentSender's paneless path, which resolves by
  key alone, so a heartbeat on the key re-admitted the token as "mara". `resolve` now marks the clash refusal with a
  Symbol (`sendertoken.CLASH`: never serialized, the words stay NO_MATCH) and resolveAgentSender keeps the refusal.
  Tested in server.paneless-sender.test.js with a control (same token and heartbeat, no clash, IS admitted).
- WARNING, filed as #4792: `resolveName` is key-level (outbox keep-time sender, the token-only reads) and still
  treats the two as one identity. Never as the other's NAME. Pinned in the #4763 arm so it is visible.
- NIT, taken: the comment claimed to cover "one of the two was stopped". It does not (one row; the stopped
  twin's token resolves as the running one). Reworded; that case is in #4792 (store the name at mint time).
- NIT, taken: resolveName's answer for the clash is asserted.
Perturbations: removing the server guard reds exactly the new paneless arm; removing the CLASH mark reds both
#4763 arms. Focused: sendertoken.test.js + server.paneless-sender.test.js, 58 of 58.

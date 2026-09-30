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

## Review 2 (opus, blind, on daac5c757), 17:28 CDT: no BLOCKER, 2 WARNINGs, 2 NITs
- WARNING, taken: POST /api/agent-token minted for any keyable name, so "mara" issued while pane agent "Mara" runs
  landed in Mara's file and resolved AS Mara (one row, no clash visible). The route now refuses (409) when one of
  our PANE rows shares the key with a different spelling. Paneless/created rows are named by their key, so they
  cannot be told apart by spelling and are not refused (re-issuing a remote agent under its own name works).
  Test in server.remote-bind-1112.test.js with a control (the pane agent's own spelling is issued).
- WARNING, taken as a correction: "never as the other's NAME" was false. The key "mara" IS agent mara's name, so
  the key-level paths let Mara act AS mara. Corrected in the test comment, here, and on #4792 (comment), which is
  now the same severity as this card. Not fixed here: the fix is the name stored on each token, and a plain
  exact-name compare would lock out remote agents whose paneless rows are named by key. Rejected for this PR:
  an outbox drain guard (the keep-time sender has no roster; #4792's fix covers it at the source).
- NIT, taken: a clash refusal logs one server line per key per process, naming the key and the sessions.
- NIT, taken: the JSON leak assertion is labelled a regression guard for a string-keyed mark.
Weakest premise: that a clash between two pane agents is the only two-row case; a created-never-run row keyed
the same as a pane row is deduped by boardKeys, so it cannot make a second row.
Perturbation: the route guard disabled reds exactly the new route arm. Focused: 73 of 73 (three files).

## Review 3 (fable, blind, on b2deebb73), 17:33 CDT: CONVERGED (no BLOCKER or WARNING), 3 NITs, all taken
- The route fails CLOSED (503, nothing written) on an unreadable roster, as create.js and the sibling roster routes do.
- Words: "agents of ours are filed under the token key" / "has a session on this computer" (a crashed-to-shell pane
  counts too, rightly, so "running" overclaimed).
- The clash log re-arms after a clean resolve (one line per clash episode, not per process).
Tests: the 503 arm (control: a readable empty roster issues) and the log arm (once, re-armed, no token in the line).
Perturbations: each guard removed reds exactly its arm. Focused: 75 of 75 (three files).
Reviewer 3's measurements: this Mac's 20 tmux sessions have no safeKey pair, so deploying mutes nobody here.

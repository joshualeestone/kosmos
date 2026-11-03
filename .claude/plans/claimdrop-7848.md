# claimdrop-7848: a request claimed by one addressed agent leaves the others' --unanswered

Card: joshualeestone/kosmos#7848 (Renet Tilley, from Splinter, 11-03). Follows #4926.

## Why
A room post addressed to several agents, claimed by one of them (`kosmos claim`), still showed in the other addressed
agents' `kosmos room <id> --unanswered`. Each had to answer the claim or the original to clear it: chatter, and a risk of
a second claim.

## The call
In the `--unanswered` view only (server.js room route, text arm): an ask whose live claim (the shaped row's `claim`,
messages.claimOf, the same holder the room and `kosmos claim` agree on) is held by another agent the post asked is
handled for the reader. It is left out of the list and the count, and named on a line under the list with who claimed it
and when, so the reader can still read it.
- "Asked" is the same reading as the reader's own ask: named in the post (messages.namedIn), or the person's post that
  reached that agent.
- A bystander's claim (an agent the post did not ask) does not answer for the agents that were asked.
- The reader's own claim is no answer: an ask it claimed and has not answered stays on its own list.
- A claim taken back puts the ask back. A later post that names the reader again is its own ask and is listed, which is
  the card's "unless a later post @-names one of them".
- No CLI change: both CLIs pass the text through.

Rejected:
- Counting any member's claim: a bystander claiming would silently drop an ask the asked agents still owe.
- Treating the reader's own claim as an answer: the claim says it is taking the work, not that it has answered.
- Changing the full room view: it already shows the claim pill on the post.

## Weakest premise
That a claim's holder is the right signal of "handled". A holder that claims and then goes quiet leaves the ask off the
others' lists until the claim is freed (the person can free it, #6949). The line under the list names the holder and how
long ago, so a stale claim is visible.

## Tests
server.roomread-claimed-7848.test.js: claimed by an asked agent (with a before-claim CONTROL; the claimer's own list
keeps it); a bystander's claim; a claim taken back and a later naming post; the person's ask. Mutations, each red:
no skip (3), any claimant (1), own claim counted (1), no person-post branch (1), no line (2). Related files 97/97.

## Review round 1 (opus, fixed)
- "Asked" now matches the reader's own reading on the person's post: an agent it went quiet for or could not reach was
  not asked, so its claim does not answer. And a post that names agents (a person's @name too) asked only those it names.
- The person's-ask test now asserts the ask left the list and the head line, not just that the claimed line appeared.
- Tests: the person naming only me; an unreached claimant; a claimant no longer on the project; the -n cap (count leaves
  claimed asks out, the claimed line is capped with how many older); every ask claimed (its own head line).
- The claimant's name is flattened as the post line's is; the claimed line is capped at -n with "and N older"; the head
  line when every ask is claimed says so; a comment says claimed asks are deliberately not dropped from the hold.
- Each fix mutation-checked. Weakest premise, added: with the registry unreadable, nobody is filtered as a non-member,
  so a removed claimant still takes the ask off; the trailing line keeps it visible.

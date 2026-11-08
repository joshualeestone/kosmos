# kosmos#8270: a room post to someone outside the project

Today a post addressed to a non-member just reaches nobody. At best the poster reads "It woke no one", with nothing
about who was not reached or how to reach them.

The call: the board adds one sentence to the post's answer, in the existing trailing note slot (`ambiguousNote`), so both
CLIs print it with no change, older CLIs included: "<name> is not on this project, so this post did not reach them. To
reach them: kosmos msg <handle>."

What counts (engine/messages.js outsidersNote): only someone it can identify: a real agent's card on this board
(isNamedOurs, since `kosmos msg` refuses a stray session), off the project, named in a header that is this poster's own
or by a whole-word @-mention. Agents' posts only.

Review 1 cut the first version's "any capitalised header name" branch. It told an agent that the person, or a member on
another computer, "did not get" a post, and it read "The team" and "Before -> After:" as people. An unknown name now keeps
today's "It woke no one" line. So a colleague on another computer is NOT named: the board
cannot tell them from the person or a phrase. That is the weakest part, chosen because a false statement is worse.
Review 2: whole names only in a header too. Deferred: a card whose pane is crashed is still offered kosmos msg (its refusal is honest); "thanks @homer" also gets the sentence (it is true).
Not changed: an unrecorded post and a retry folded into the first copy carry no note, as ambiguousNote did not before (an in-flight fold can repeat it).
Rejected: a new answer field (both CLIs and every older one would need teaching, for one sentence).

# kosmos#8270: a room post to someone outside the project

Today a post addressed to a non-member just reaches nobody. At best the poster reads "It woke no one", with nothing
about who was not reached or how to reach them.

The call: the board adds one sentence to the post's answer, in the existing trailing note slot (`ambiguousNote`), so both CLIs
print it with no change, older CLIs included: "<name> is not on this project, so this post did not reach them.", then
"To reach them: kosmos msg <handle>." when the name is an agent on this board, else "Add them to the project, or reach
them another way."

What counts (engine/messages.js outsidersNote): read as addressedMembers reads a post. A capitalised name in the post's header
(a "Sender to Name:" header only when Sender is the poster) that resolves to no member, or a header name or @-word that resolves to an agent on this board outside the project.
Agents' posts only; the person's page already shows who is on the project.

Rejected: warning on every @-word that matches no member (an @-word is often not a person); a new answer field (both
CLIs and every older one would need teaching, for one sentence).
Weakest premise: `kosmos msg` reaches only agents on this computer. A roster card is on this board, so it should hold.

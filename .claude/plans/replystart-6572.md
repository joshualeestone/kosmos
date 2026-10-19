# replystart-6572: say that `kosmos reply` also starts a message

Card: kosmos#6572 (agent feedback 10-19). An agent wanting to raise something with its
person, unasked, found no command for it and concluded none exists.

## Finding
The command exists. `POST /api/reply` (server.js) resolves the sender and appends to the
person's direct conversation (`keepAgentReply` -> `chat.appendMessage(chat.DIRECT, ...)`).
Nothing checks for an earlier message from the person. Every description of it says
"answer", so the agent's conclusion was reasonable and wrong.

## Call
Neither option on the card as worded. Option 1 (a new verb) would be a second command for
the same route. Option 2 as worded ("by design you cannot") would be false. The fix is the
wording:
- doctrine (engine/defaults.js, "Telling people what is happening"): `kosmos reply` starts a
  message too; it is the command for the four reports to the person; a question only they
  can answer is also reported as needs_you. v33 -> v34, logged, pinned, past table regenerated.
- help line on the Mac CLI (install/kosmos) and the Windows CLI (tools/windows/kosmos-cli.js).

## Weakest premise
That unasked messages are welcome. Bounded by the section's own "report four things, do not
narrate". If people find it noisy, change this line, not the route.

## Not done
No new heading, so an agent whose copy of that section was edited is not re-offered it
(same as v32, v33).

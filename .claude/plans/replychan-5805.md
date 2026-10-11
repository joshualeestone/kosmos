# replychan-5805: a room ask answered on the person's direct thread is answered (kosmos#5805 part 2)

## The defect
The room's reply reminder (#185: messages.unanswered, the room's "has not answered" line, and sweepUnanswered's one
nudge) counts an agent's answer to the person's @-mention only when the agent posts in that room. An agent that
answers the person on their direct thread (`kosmos reply`) is still shown as not answering, and is nudged.

## The change
engine/messages.js unanswered(): when the room shows no answer from a mentioned agent, its direct thread with the
person is read (once per agent per call, only then); a row from the agent itself, not Kosmos's own words in its name
(`kosmos: true`), at or after the ask, answers it. The nudge (sweepUnanswered) reads unanswered(), so it follows.

## Decided
- Counted automatically; nothing for the agent to declare. The card asked to "let an agent declare its reply channel".
  Rejected: a per-agent setting and a command to set it. The reminder exists so the person who asked hears back; a
  direct reply to that same person does that whatever was declared, and a declaration is one more thing an agent
  must remember to do before the reminder stops lying.
- Only the person's direct thread. Discord or another outside channel is not visible to Kosmos (out of scope), and a
  `kosmos msg` to a colleague is not an answer to the person.
- Weakest premise: the direct reply may be about something else, and the room then reads answered. What would change
  it: reports of asks left unanswered because a DM on another subject cleared them; then match on in_reply_to.
- An unreadable thread counts as no answer (today's behaviour).

## Tests
engine/messages.test.js: an ask stays unanswered with mara's earlier reply, Kosmos's own notice in her name, and the
person's own message on the thread (controls); her direct reply after the ask clears it.

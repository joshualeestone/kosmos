# roomheld-4934: a loop-guard refusal says nothing was kept, and not to send it another way

Card: kosmos#4934 (0.7.15 five-family diagnostic H1, Grok and Gemini): when the room loop guard holds a room,
`kosmos post` said "not sent" and handed the text back; later the same post showed in the room, and senders had often
already re-sent it by direct message, so people got it twice.

## What the code does (measured on main)
engine/messages.js sendPost: the room valve returns `could_not` BEFORE the post is given an id or stored; it logs only a
`valve` notice and one `refused` row per agent ("X tried to post here and Kosmos stopped it"), neither carrying the text.
Nothing re-sends it: there is no outbox for a refused room post (the CLI's outbox is only for a wrong-world board). So a
loop-guard refusal is never "delivered later": what showed later was the agent's own re-post. The card's suggested
"held" wording would be false (nothing holds it).

## Done looks like
An agent whose post the loop guard refused is told, in agent terms, that nothing was sent to anyone and nothing was
kept, and not to send it another way, only to post it here again once its person has posted in the room or reopened
it; the text is handed back to keep.

## Change
- engine/messages.js: the valve's refusal carries `code: 'room_held'` (as the which-room hold carries `which_room`).
- install/kosmos and tools/windows/kosmos-cli.js: on `room_held`, two agent-facing lines replace the person-facing
  sentence ("...asked everyone to bring you in"), and the hand-back reads "Here it is to keep:". Other refusals unchanged.

## Decisions
- Wording, not a held state: the board keeps nothing, and making it keep and deliver later would be a new delivery
  path for a guard whose purpose is to stop the loop until the person steps in. Rejected: "held" (false today).
- "Once your person has posted in the room or reopened it": both reset the valve (an operator post moves countFrom; a
  reopen marker likewise). The reopen is not rendered in the room, so the agent may not see it; it will see the
  person's post, or its own retry will land.
- Weakest premise: that the duplicates came from the agent's re-post rather than some delivery path I did not find. I
  read sendPost's valve branch (returns before the id) and searched for an outbox of refused posts; there is none.

## Validation
engine/messages.test.js (the valve refusal carries room_held, has no id, and stores no row); cli.room-reopen-2710 and
tools.windows-kosmos-cli-570 (both CLIs' room_held wording, the person-facing sentence never shown, text handed back;
the generic refusal unchanged). Three mutants (no code; either CLI branch off) each fail a test.

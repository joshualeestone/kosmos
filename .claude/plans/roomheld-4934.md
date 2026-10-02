# roomheld-4934: a loop-guard refusal says nothing was kept, and not to send it another way

Card: kosmos#4934 (0.7.15 five-family diagnostic H1, Grok and Gemini): when the room loop guard holds a room,
`kosmos post` said "not sent" and handed the text back; later the same post showed in the room, and senders had often
already re-sent it by direct message, so people got it twice.

## What the code does (measured on main)
engine/messages.js sendPost: the room valve returns `could_not` BEFORE the post is given an id or stored; it logs only a
`valve` notice and one `refused` row per agent ("X tried to post here and Kosmos stopped it"), neither carrying the text.
Nothing re-sends a LIVE refused post: the CLI's outbox is only for a wrong-world board (and a post that went there is retried by the outbox drain, through the same guard, without these words). So a
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

## Review 1 (2 warnings, 2 nits), taken
- After the CLI's cut-reply retry (#4580) the first try may already be in the room, so a room_held answer to the retry
  says "Not posted this time ... your first try may have reached the room: check kosmos room <project>" instead of
  "Nothing was sent" (both CLIs; tests cut the first send and refuse the retry).
- The engine test's "not stored" filter used the wrong row kind (room posts are kind 'post'), so it could not fail; fixed.
- "or in about an hour": the valve's window is a rolling hour, so the room also reopens on its own.
- The "never delivered later" claim is scoped to a LIVE post: a post that first went to the outbox (wrong-world board)
  is retried by the outbox drain through the same guard, and the agent never sees these words on that path.

## Review 2 (1 warning, 0 nits), taken
- A piped copy after a cut-reply retry said "The piped message was not sent", which is inaccurate because the first try
  may have landed before the connection cut. Fixed on both CLIs (install/kosmos and tools/windows/kosmos-cli.js) to pass
  maybe, outputting "The piped message may not have been sent; a copy is saved at <file>. Check before sending it again."
- Tests added in cli.busy-health-4466.test.js and tools.windows-kosmos-cli-busy-4466.test.js covering the --stdin retry case.

## Review 3 (0 blockers, 0 warnings, 0 nits). CONVERGED.
- Parity between Mac and Windows CLIs confirmed across normal post, retried post, piped post, and retried piped post.
- Test assertions verified with positive matches and negative controls (neither CLI says "Nothing was sent to anyone" or
  "was not sent" on retries, and both provide appropriate follow-up instructions).
- No em dashes in code, comments, or documentation.

## Validation
engine/messages.test.js (the valve refusal carries room_held, has no id, and stores no row); cli.room-reopen-2710 and
tools.windows-kosmos-cli-570 (both CLIs' room_held wording, the person-facing sentence never shown, text handed back;
the generic refusal unchanged); cli.busy-health-4466 and tools.windows-kosmos-cli-busy-4466 (cut-reply retry arms for
both argument and --stdin posts on both CLIs). Mutant checks confirm test coverage.


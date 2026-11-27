# kosmos#9240: a delivery-check probe that needs no reply

## Problem
Colleagues sent bare delivery-check messages; only one was marked as needing no reply, so each looked like a request
and the receiver answered every one: a wasted turn per message on both sides (agent feedback, 2026-11-27).

## Measured first
Both halves of the ask already exist on main: `kosmos msg --no-reply` (#7893) replaces the receiver's answer line with
"FYI, no reply requested", and every send prints its id with "kosmos msg --status mN says later whether they answered
or read it" (#8961). And marking a test message --no-reply is already TAUGHT, in the block every project member gets
(engine/projects.js, #9096: "only closes a thread or tests delivery ... put --no-reply first", pinned by
fyihint-9096). My first search missed that line because it says "tests delivery", not "delivery check" (corrected
after review round 1). What is taught nowhere is that a delivery check needs no message at all: msg --status is the
receipt. That is also the part that saves the receiver's turn: a --no-reply probe is still typed into its pane.

## Change
In the project block (engine/projects.js, the member rules every project member gets, whoever wrote its
instructions), beside the --no-reply rule that #9096 put there:
- "or tests delivery" comes off the --no-reply line, which taught sending a probe (marked, but still typed into the
  receiver's pane);
- a line after it: do not send a test message to see if your direct messages reach someone: send the real one, then
  run `<cli> msg --status <id>` with the id your send printed; it says whether it reached them and, when Kosmos can
  tell, whether they read or answered it; that they have not read it yet, or may read it later, is no reason to send
  it again. A room post needs no test either: the post command says whom it reached (both CLIs print who it woke).
So one block gives one answer. engine/probe-9240.test.js pins both (each reds under its own mutation), and
fyihint-9096's pinned rule is updated to the new wording.

## Where it reaches, and why not further
Review round 3 found the first version (the colleagues block in engine/messages.js) reaches role-template agents
only, and that the project block still taught the probe. The project block reaches every project member. An agent on
no project, made from its person's own words, is not reached; the text that reaches every agent is the doctrine
block (engine/defaults.js), whose change bumps DOCTRINE_VERSION and shows the whole fleet a changed-instructions
notice, too heavy for one sentence while the project block covers where agents message colleagues. A change to the
project block's member rules owes its members a re-read line too (rulesChangedIn), but only them, and only when their
block is next rewritten (a membership change), not the whole fleet at once.

## Rejected
- Inferring "FYI" from a bare code: the mark is "set only by the caller, never inferred from the words", and a short
  code can be a real question.
- A new probe verb or an automatic receipt: msg --status already is the receipt.

## Weakest premise
That agents read the guide at the moment they decide to probe. If probes keep coming, the next step is a hint printed
by `kosmos msg` itself when the text is a single word.

## Known, not handled
- (Next step, kosmos#9240 follow-up.) A send that times out tells the agent "check with them before sending it again",
  and an unconfirmed one "Do not re-send; check with them" (both CLIs). That is the probe this card wants gone, said
  at the moment the agent is least sure. Pointing those lines at `msg --status` changes both CLIs' send output and the
  tests that pin it, so it is its own change.
- `msg --status` reads direct messages only; a room post is answered by its own output (whom it reached).
- A send that printed no id (a duplicate of a message the board already has, or an older board) leaves the agent no id
  to ask about. Rare; the line says "the id your send printed".

## Review stop
Eight blind rounds (opus and sonnet alternating), then stopped by Splinter's usage rule (Fleet Builders m510,
2026-10-26). Round 8's WARNINGs are kosmos#9243: the CLIs' timeout and unconfirmed lines that still say "check with
them", no guidance with nothing real to send yet, an "unknown" status answer, and an unreached post.

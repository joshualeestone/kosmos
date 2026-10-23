# claimfollow-6957: room claims, the leftovers of #6952's review round 8

Card: kosmos#6957 (claimed: icecreamkitty, by Renet's night-shift --claim). Stacked on claimfix-6952 (#6952); the PR
opens after #6952 merges.

## Decision
1. **Released means released.** When every asked member still in the room has claimed the post and then given it
   back, the post is open (`gaveBack`: a `claim: true` add from them on this post, and no live claim now). Before, bob
   releasing "because I am out of usage" left cy sent to ask bob for up to 30 minutes.
2. **More room phrasings count** (CLAIM_ROOM_ASK): "Who's free..." (straight or curly apostrophe), "who has time...",
   "anyone around to...", a bare "anyone else?", "need someone to...". Passing mentions still do not ("@bob ask whoever
   is around in billing", "the bug someone else reported", "check who is free on Friday").
3. **The window is capped** at 30 minutes, so a post dated ahead of this clock (a clock stepped back) never holds
   longer.
4. **A post's own author can always claim it** ("@bob I am taking the parser, FYI").
5. **The reserved-name refusal says what to do** ("rename this agent to react or claim"), for an agent named
   `operator` from before #6952.
6. **The person's lone 🙋 is left off the reactions line when no claim is live.** It agrees with a claim, so with none
   it would read as theirs.

Not done, recorded: an end-to-end test through sendPost (the engine tests still write `mentioned` by hand); one clause
asking the room ("@bob fix X. Can someone review it after?") still opens the whole post (fails open, as before #6952);
an agent named `operator` can still post, and its posts read as the person's in the text view.

## Proof
engine/roomclaim-6946.test.js #6957 (each with a control that can return the dangerous answer) and
server.projects.test.js #6946 (the lone 🙋 after the release, through the real route). Mutants, each red: the release
rule, the author rule, the cap, the "who's" form, the lone-🙋 filter.

## Weakest premise
That a give-back means the asked member is done with it. A member who releases to hand it to a specific colleague
would do that in a post of its own, which asks the colleague; this rule opens it to anyone instead.

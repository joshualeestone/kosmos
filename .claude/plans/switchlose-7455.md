# switchlose-7455: a switch saved but not restarted says the conversation will be lost (kosmos#7455)

## Finished looks like
- When a provider switch is saved but the agent cannot be restarted, and the switch starts a new conversation (across
  the Claude line, onto or off a vendor's Claude config folder, or between two runners), the result adds, after "It is
  still running as before until it restarts." and any "When it restarts it will run on ...":
  "When it does start again, it starts a new conversation, and anything it only remembered from talking will be lost."
- A switch that keeps its conversation keeps today's sentence (nothing added).
- Both not-restarted branches of the provider route (the engine partial and the restart that failed) say it.

## Decisions
- setProvider returns losesConversation from switchLosesConversation itself, apart from the notes copy, which can
  fail and leave `carried` null; a check that throws falls back to whether notes were carried.
- Future tense, as the route's own comment asks for this branch: nothing is lost yet.
- Weakest premise: switchLosesConversation is the single rule for "starts a new conversation" (#7410, #7445). If a
  runner pair is added there later, this follows it automatically.

## Verify
- engine/create.switchmem-7410.test.js: 34 pass with the change; 3 fail on today's code (the new cases).
- Related switch and provider tests: 66 + 60 pass.

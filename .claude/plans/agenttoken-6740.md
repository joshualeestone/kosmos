# agenttoken-6740: a CLI test never runs the CLI as the agent running it

Card: kosmos#6740 (filed by April; given to me by Splinter 11:46).

## Why
An agent's shell carries KOSMOS_AGENT_TOKEN (and KOSMOS_AGENT_SESSION from the supervisor). A test that hands
`{ ...process.env }` to the kosmos CLI then runs the CLI as that agent, and the sandbox board refuses or reroutes it.
tools/run-tests.sh already unsets all three names for `yarn test` (#4491, #5933), so the suite and CI were clean; the
red appears when ONE file is run directly with `node --test`, which is how an agent checks a test.

MEASURED in my agent shell on this tree: cli.msgqueue-5187, cli.limitmsg-5805 and server.subtasks-3861 each failed 3
tests as inherited and 0 with the identity cleared (subtasks-3861 is the one #5933 named; it was not in the card).

## What changes
- test-support/agent-env.js: AGENT_IDENTITY (the three names) and withoutAgentIdentity(env), a copy without them.
- The three tests build the CLI's environment from withoutAgentIdentity(process.env).
- tools.agent-env-6740.test.js: every name the helper clears is also unset by tools/run-tests.sh (the lists cannot
  drift), and the helper removes exactly those names and leaves its input alone.

## Decided
- A shared helper used by the failing tests, not an edit to all 76 CLI tests that spread process.env: most pass today.
  Which others fail when run directly in an agent's shell is MEASURED by a sweep (see below), not assumed.
- No change to tools/run-tests.sh: it already does this for the suite.

## Mutants (measured)
- helper a no-op: cli.msgqueue-5187 and server.subtasks-3861 fail 3 each again in the agent shell.
- the runner drops KOSMOS_AGENT_SESSION from its unset line: the pin test fails.

## Weakest premise
That these three names are the whole of the agent identity a CLI test can inherit. install/kosmos recognises an agent
by KOSMOS_AGENT_SESSION or KOSMOS_AGENT_TOKEN (line ~1468), and TOKEN_ONLY changes which token it sends; a future
identity variable would need adding here, and the pin test would not notice its absence from both lists.

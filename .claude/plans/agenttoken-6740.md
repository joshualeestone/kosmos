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
- The three tests build the CLI's environment from withoutAgentIdentity(process.env), and so do two more the sweep
  found: cli.task-webhook-1307 (1 red as inherited, 0 cleared) and cli.unknown-flag-4889 (4 red, 0 cleared).
- cli.sandbox-data-4796 (the #4796 guard that no CLI test can send the LIVE board token to a stub board) recognised
  only a literal `...process.env`, so the helper hid the inheritance from it and it reported the tests as having "no
  environment of its own". That is a security guard going blind, not a cosmetic red: a later test inheriting the live
  data root through the helper would have passed it. Its pattern now reads `...withoutAgentIdentity(process.env)` as
  inheriting, held to the same data-root rule, with two control cases (flagged without a root, passed with one; the
  old pattern fails the first).
- tools.agent-env-6740.test.js: every name the helper clears is also unset by tools/run-tests.sh (the lists cannot
  drift), and the helper removes exactly those names and leaves its input alone.

## Sweep (measured)
The population, stated by what was counted: 98 test files (repo root and engine/) whose source both contains
`...process.env` and names the CLI (install/kosmos, kosmos-cli.js or 'install','kosmos'), excluding the three already
known to leak. Each was run DIRECTLY in my agent shell, then re-run with the identity cleared where it failed. After the fixes, the 98 plus the five files this branch changes or adds,
102 distinct (cli.sandbox-data-4796 is in both), all pass as inherited, one line per file recorded. The first sweep reported 0 failures and was false: xargs
could not build its command, so no test ran. The second wrote one line per file (98 of 98) before trusting the count.

## Decided
- A shared helper used by the failing tests, not an edit to every CLI test that spreads process.env (76 of the 81
  cli.*.test.js files do): most pass today.
  Which others fail when run directly in an agent's shell is MEASURED by a sweep (see below), not assumed.
- No change to tools/run-tests.sh: it already does this for the suite.

## Mutants (measured)
- helper a no-op: cli.msgqueue-5187 and server.subtasks-3861 fail 3 each again in the agent shell.
- the runner drops KOSMOS_AGENT_SESSION from its unset line: the pin test fails.

## Review 1 (applied)
- [WARNING] the guard knew only the spread form; `env: withoutAgentIdentity(process.env)` or a variable assigned from
  it matched nothing and then passed. Now the helper in any non-spread shape is flagged outright, as `env:
  process.env` is (two controls; conservative on purpose: such a shape can carry no data root after it).
- [NIT] the pin now runs both ways (a KOSMOS_AGENT_* the runner clears must be in the helper too).
- [NIT] left, recorded: install/kosmos also reads an inherited TMUX_PANE (through the pane's @kosmos_agent claim) as
  an agent. These tests set TMUX_PANE themselves and the sweep is green, so it is not red today.

## Review 2 (converged: no new issues at WARNING or above)
Left, recorded: the guard keys on the helper's literal name, so a renamed import (`{ withoutAgentIdentity: clean }`)
would slip past it, as any wrapper of process.env always has; the pin parses only top-level `unset` lines, so a
runner that moved its unset into a function would empty direction 2 silently (direction 1 would go red).

## Weakest premise
That these three names are the whole of the agent identity a CLI test can inherit. install/kosmos recognises an agent
by KOSMOS_AGENT_SESSION or KOSMOS_AGENT_TOKEN (line ~1468), and TOKEN_ONLY changes which token it sends; a future
identity variable would need adding here, and the pin test would not notice its absence from both lists.

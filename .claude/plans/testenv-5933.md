# testenv-5933: the suite does not inherit the agent's identity (kosmos#5933)

Since #5898 every agent launches with KOSMOS_AGENT_TOKEN and KOSMOS_AGENT_SESSION, and install/kosmos
treats a process carrying either as an agent that presents its token. A CLI test that spreads
process.env then presents a token its sandbox board never issued: server.subtasks-3861 went 3 red in an
agent's own validation while CI was green.

## Plan
- tools/run-tests.sh unsets both at its boundary, beside KOSMOS_AGENT_TOKEN_ONLY (#4491 slice 7).
- tools/test-run-tests-codexhome-2858.sh guards the line: flush-left before the node suite, and a probe
  running the runner's own line with both poisoned (with a control arm that must see the poison).
- Left, decided: TMUX_PANE (a third input to install/kosmos's agent check, only with a live tmux claim);
  most tests set it themselves and stripping it would change every tmux-reading path unmeasured.

## Review
Three blind rounds (sonnet, opus, sonnet). Round 3: no blocker, warning or concern.

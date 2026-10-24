'use strict';
/**
 * kosmos#6740: the agent identity a test must not inherit from the shell that runs it.
 *
 * An agent's own shell carries KOSMOS_AGENT_TOKEN (and the supervisor exports KOSMOS_AGENT_SESSION into every pane), so
 * a test that hands `{ ...process.env }` to the kosmos CLI runs that CLI AS the agent running the test: the board then
 * refuses or reroutes what the test meant as a person's command. Measured 2026-10-20 (agent shell, the same tree):
 * cli.msgqueue-5187, cli.limitmsg-5805 and server.subtasks-3861 each failed 3 tests with the shell's variables and
 * passed with these cleared. A person's shell and CI carry none of them, which is why it only ever went red for agents.
 *
 * tools/run-tests.sh already unsets all three for the whole suite (#4491, #5933), so `yarn test` was never the
 * problem: the red came from running ONE test file directly, `node --test <file>`, which is how an agent checks a
 * test, and which bypasses the runner. So a test that hands its environment to the CLI clears these itself.
 * tools.agent-env-6740.test.js pins that every name here is also unset by the runner, so the two lists cannot drift.
 * The CLI clears the same two when it starts a board itself (install/kosmos: `env -u KOSMOS_AGENT_SESSION -u
 * KOSMOS_AGENT_TOKEN`).
 */
const AGENT_IDENTITY = ['KOSMOS_AGENT_TOKEN', 'KOSMOS_AGENT_SESSION', 'KOSMOS_AGENT_TOKEN_ONLY'];

/** A copy of `env` with the agent identity removed (the input is not changed). */
function withoutAgentIdentity(env) {
  const out = { ...env };
  for (const k of AGENT_IDENTITY) delete out[k];
  return out;
}

module.exports = { AGENT_IDENTITY, withoutAgentIdentity };

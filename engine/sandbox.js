'use strict';
/**
 * A board is sandboxed whole or not at all (#634).
 *
 * A fixture board with AGENT_WORKFORCE_DATA and AGENT_WORKFORCE_PROJECTS
 * pointed at a temp dir delivered a test message into two real agents' tmux
 * panes and rewrote the kosmos:projects block in two real workers' CLAUDE.md
 * files, because WORKERS and tmux were still pointed at the fleet. Two of five
 * knobs sandboxed produced justified confidence while three stayed live. A
 * half-sandboxed board is more dangerous than an obviously live one, because
 * nobody runs an obviously live board carelessly.
 *
 * So the rule is one decision, not five: if ANY of the four directories is
 * sandboxed, all four must be, and tmux must be inert (AGENT_WORKFORCE_TMUX_BIN
 * pointing at a stub, or AGENT_WORKFORCE_DRY_RUN=1, which makes every tmux
 * call a no-op). Otherwise the board refuses to start and names what is still
 * live. An unsandboxed board (nothing set) is the product and is allowed.
 *
 * AGENT_WORKFORCE_HALF_SANDBOX_OK=1 overrides, for the person who has read this
 * and means it. It is a sentence in the environment, not a default.
 */

const DIRS = [
  ['AGENT_WORKFORCE_DATA', 'the data store (~/Library/Application Support)'],
  ['AGENT_WORKFORCE_PROJECTS', 'the projects folder (~/Kosmos/Projects)'],
  ['AGENT_WORKFORCE_WORKERS', "the workers folder, where agents' CLAUDE.md files live (~/work/workers)"],
  ['AGENT_WORKFORCE_LAUNCH', 'launchd (~/Library/LaunchAgents)'],
];

function audit(env) {
  const set = DIRS.filter(([k]) => env[k]).map(([k]) => k);
  const live = DIRS.filter(([k]) => !env[k]);
  const tmuxInert = Boolean(env.AGENT_WORKFORCE_TMUX_BIN) || env.AGENT_WORKFORCE_DRY_RUN === '1';
  if (!tmuxInert) live.push(['tmux', "tmux, so a send would type into a real agent's pane (set AGENT_WORKFORCE_TMUX_BIN to a stub or AGENT_WORKFORCE_DRY_RUN=1)"]);
  const partial = set.length > 0 && live.length > 0 && env.AGENT_WORKFORCE_HALF_SANDBOX_OK !== '1';
  return { partial, set, live: live.map(([k, what]) => ({ key: k, what })), tmuxInert };
}

function sentence(a) {
  return 'Kosmos will not start half-sandboxed: '
    + a.set.join(', ') + (a.set.length === 1 ? ' is' : ' are') + ' pointed at a sandbox, but these are still the real fleet: '
    + a.live.map((l) => l.key + ' (' + l.what + ')').join('; ')
    + '. A board like this has typed into real agents and rewritten real files (#634). Sandbox all of them, or set none.';
}

module.exports = { audit, sentence, DIRS };

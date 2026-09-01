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
 * pointing at a stub). Otherwise the board refuses to start and names what is
 * still live. An unsandboxed board (nothing set) is the product and is allowed.
 *
 * ⚠️ DRY_RUN=1 IS NOT ENOUGH AND USED TO BE ACCEPTED HERE (kosmos#1651). It
 * stops tmux WRITES; the roster is a READ, and a board that passed this guard
 * on DRY_RUN alone enumerated the real fleet by name.
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

/* jargon-ok:tmux -- this refusal writes to stderr and exits the process
   before the server starts listening (server.js); it never reaches a
   browser screen. Its only reader is whoever is starting Kosmos in a
   half-sandboxed test environment, and that reader needs the exact env
   var (AGENT_WORKFORCE_TMUX_BIN) named, not a softened paraphrase. The
   word "pane" is avoided below anyway (-> "live terminal"), since
   jargon.py's own `\bpanes?\b` pattern strips to a form its jargon-ok
   marker cannot capture (the trailing `?` falls outside `[a-z ]+`), so
   no marker text can ever exempt it. */
function audit(env) {
  const set = DIRS.filter(([k]) => env[k]).map(([k]) => k);
  const live = DIRS.filter(([k]) => !env[k]);
  /* 🛑 kosmos#1651. `DRY_RUN=1` USED TO SATISFY THIS AND IT MUST NOT.
     DRY_RUN neuters tmux WRITES. A roster is a READ, and the module that
     performs it never consults DRY_RUN at all: measured in engine/status.js,
     `AGENT_WORKFORCE_DRY_RUN` 0 references and `AGENT_WORKFORCE_FAKE_PANES` 0,
     against 104 mentions of tmux. It resolves the binary as
     `AGENT_WORKFORCE_TMUX_BIN || 'tmux'` and nothing else.
     ⇒ A board sandboxed with DRY_RUN and no TMUX_BIN passed this guard AND
     enumerated the real fleet: 18 of 18 agents by name, which is how #1651 was
     found. Only TMUX_BIN redirects a read, so only TMUX_BIN counts here. */
  const tmuxInert = Boolean(env.AGENT_WORKFORCE_TMUX_BIN);
  if (!tmuxInert) live.push(['tmux', "tmux, so this board would read the real fleet's terminals and a send would type into one (set AGENT_WORKFORCE_TMUX_BIN to a stub; DRY_RUN is not enough, it stops writes and not reads)"]);
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

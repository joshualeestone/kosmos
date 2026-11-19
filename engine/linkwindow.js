'use strict';
/**
 * kosmos#8719 part 2: link a running window to its agent, so Kosmos treats it as its own.
 *
 * Kosmos ties a window to an agent by a tmux session option it sets at launch, `@kosmos_agent` equal to the session's
 * name (bin/agent-supervisor.sh; read by launchidentity.paneSessionIsOurs). A window started by hand never gets it, so
 * Kosmos will not type into it (chat.addressable), restart refuses, and nothing set the mark after the fact.
 *
 * This sets that one mark on one named session, when a PERSON asks for it from the board and confirms. It never runs
 * on its own: the guard exists so that Kosmos does not type into a window it cannot tie to an agent, and linking is
 * the person saying "this window is that agent". So it refuses whenever the window is not plainly that agent:
 *   - no session is named exactly for the agent (the board's untied card can also come from a looser name match);
 *   - the session already carries the mark (nothing to do);
 *   - the program in it is not Claude (a shell after a crash, an editor, Codex);
 *   - no agent is running in it now (status.isAgentSession);
 *   A Codex, Antigravity or Grok window would need its runner recorded too (`@kosmos_runner`): an empty runner reads
 *   as Claude and would route it through the wrong classifier, so those are refused with a reason, not linked wrongly.
 * After setting the mark it reads it back from tmux and reports linked only if the read shows it.
 *
 * Not here: the launch job. A linked window is reachable by message at once, but restart still needs a job; and the
 * window keeps the environment it was started with (no KOSMOS_AGENT_TOKEN) until Kosmos starts it.
 * Windows: ownership there is a separate record (win32sessions), so this refuses on Windows.
 */
const childProcess = require('node:child_process');
const status = require('./status');
const { paneSessionIsOurs } = require('./launchidentity');

const OUTCOME = { LINKED: 'linked', REFUSED: 'refused' };

let runner = null;   // tests: (bin, args) -> { ok, code, stdout }
function setRunner(fn) { runner = typeof fn === 'function' ? fn : null; }
function tmuxBin() { return process.env.AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux'; }
function run(args) {
  if (runner) return runner(tmuxBin(), args);
  const r = childProcess.spawnSync(tmuxBin(), args, { encoding: 'utf8', timeout: 5000 });
  return { ok: r.status === 0, code: r.status, stdout: String(r.stdout || '') };
}

function refused(because) { return { outcome: OUTCOME.REFUSED, because }; }

/**
 * Whether the window called `name` can be linked, from the board's own tmux look (`panes`: status.panesWithCommands).
 * Returns { ok: true, session } or a refusal.
 */
function plan(name, panes, platform) {
  const clean = String(name == null ? '' : name).trim();
  if (!clean) return refused('that is not a name we can read');
  if ((platform || process.platform) === 'win32') return refused('Linking a window is not available on Windows yet.');
  const mine = (Array.isArray(panes) ? panes : []).filter((p) => p && p.session === clean);
  if (!mine.length) return refused(`There is no window called ${clean} to link.`);
  if (mine.some((p) => paneSessionIsOurs(p.session, p.claim))) return refused(`${clean}'s window is already linked to Kosmos.`);
  /* What runs in it first: the board never counts an unmarked Codex (or Antigravity, Grok) window as an agent at all
     (status.isFleetSession), so asking isAgentSession first would tell that person "no agent is running", which is
     false. One pane per session (status.onePanePerSession), so `mine[0]` is the window. */
  const pane = mine[0];
  if (!status.isClaudeCommand(pane.command)) {
    return refused(`The window called ${clean} is running ${pane.command || 'nothing we can name'}, not Claude. Only a Claude window can be linked for now.`);
  }
  if (!status.isAgentSession(pane)) return refused(`No agent is running in the window called ${clean}, so there is nothing to link.`);
  return { ok: true, session: clean };
}

/** Link the window called `name`. `panes` is the board's roster read; read again here when not given. */
function link(name, opts) {
  const o = opts || {};
  const panes = Array.isArray(o.panes) ? o.panes : status.panesWithCommands();
  const p = plan(name, panes, o.platform);
  if (!p.ok) return p;
  const target = `=${p.session}`;   // exact: never a prefix match onto another session
  const set = run(['set-option', '-t', target, '@kosmos_agent', p.session]);
  if (!set || set.ok === false) return refused(`Kosmos could not mark the window called ${p.session}. Nothing was changed.`);
  const read = run(['show-options', '-v', '-t', target, '@kosmos_agent']);
  const now = read && read.ok !== false ? String(read.stdout || '').trim() : '';
  if (now !== p.session) return refused(`Kosmos marked the window called ${p.session} but could not read the mark back, so it is not treated as linked.`);
  return { outcome: OUTCOME.LINKED, session: p.session };
}

module.exports = { OUTCOME, plan, link, setRunner };

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
 *   - no window carries the agent's name (the pane's `name`, which the board keys cards on: the session with a
 *     `-discord` or this Kosmos's world suffix stripped). The mark is set on that pane's raw `session`, which is what
 *     launchidentity.paneSessionIsOurs compares it with;
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
  const mine = (Array.isArray(panes) ? panes : []).filter((p) => p && p.name === clean && typeof p.session === 'string' && p.session);
  if (!mine.length) return refused(`There is no window called ${clean} to link.`);
  if (mine.some((p) => paneSessionIsOurs(p.session, p.claim))) return refused(`${clean}'s window is already linked to Kosmos.`);
  /* What runs in it first: the board never counts an unmarked Codex (or Antigravity, Grok) window as an agent at all
     (status.isFleetSession), so asking isAgentSession first would tell that person "no agent is running", which is
     false. status.onePanePerSession keeps one ranked pane per board NAME (so `zara` and `zara-discord` are one), and
     the already-linked check above ran over every pane carrying the name before that choice mattered. */
  const pane = status.onePanePerSession(mine)[0] || mine[0];
  if (!status.isClaudeCommand(pane.command)) {
    return refused(`The window called ${clean} is running ${pane.command || 'nothing we can name'}, not Claude. Only a Claude window can be linked for now.`);
  }
  /* And it must look like an agent to the board: a native version string always does, while an unmarked `node` could
     be any program and is refused here. */
  if (!status.isAgentSession(pane)) return refused(`Kosmos cannot tell that the window called ${clean} is running an agent, so it was not linked.`);
  return { ok: true, session: pane.session, pane: pane.pane, name: clean, command: pane.command };
}

/** Link the window called `name`. `panes` is the board's tmux look; read again here when not given. */
function link(name, opts) {
  const o = opts || {};
  if ((o.platform || process.platform) === 'win32') return refused('Linking a window is not available on Windows yet.');
  const panes = Array.isArray(o.panes) ? o.panes : status.panesWithCommands();
  const p = plan(name, panes, o.platform);
  if (!p.ok) return p;
  /* `=session:` names exactly that session (its active pane). Measured on tmux 3.6a: `set-option -t =zara` and
     `display-message -t =zara` do not resolve (an option or message target is a pane), while `=zara:` does, and never
     reaches `zarah`, nor marks anything when only `zarah` exists. */
  const target = `=${p.session}:`;
  /* The look reads the very pane plan() checked (a split window's active pane may be a shell), plus the session's id
     and its current mark. */
  const paneTarget = /^\d+\.\d+$/.test(String(p.pane || '')) ? `${target}${p.pane}` : target;
  const look = () => {
    const r = run(['display-message', '-p', '-t', paneTarget, '#{session_id}\t#{pane_current_command}\t#{@kosmos_agent}']);
    const [lid = '', lcmd = '', lclaim = ''] = (r && r.ok !== false ? String(r.stdout || '').replace(/\n$/, '') : '').split('\t');
    return { id: lid, cmd: lcmd, claim: lclaim.trim() };
  };
  /* The session's id and program just before the mark and again just after: the same pair, or the window was
     replaced (even by another Claude session of the same name) and nothing is linked. A mark already there (Kosmos's own
     supervisor started this session since the board's look) refuses before anything is set. */
  const before = look();
  if (before.claim) return refused(`${p.name}'s window is already linked to Kosmos.`);
  if (!before.id || !status.isClaudeCommand(before.cmd)) return refused(`Kosmos could not confirm what runs in the window called ${p.name}, so nothing was linked.`);
  const set = run(['set-option', '-t', target, '@kosmos_agent', p.session]);
  if (!set || set.ok === false) return refused(`Kosmos could not mark the window called ${p.name}. Nothing was changed.`);
  const read = run(['show-options', '-v', '-t', target, '@kosmos_agent']);
  const now = read && read.ok !== false ? String(read.stdout || '').trim() : '';
  const after = look();
  /* Another session now holds the name: the mark on it cannot be told apart from one Kosmos's own supervisor stamped
     there, so it is left alone and nothing is claimed linked. */
  if (after.id !== before.id) {
    return refused(`The window called ${p.name} changed while Kosmos was linking it, so nothing was linked. Look again before trying.`);
  }
  if (now !== p.session || after.cmd !== before.cmd) {
    const off = run(['set-option', '-u', '-t', target, '@kosmos_agent']);
    if (!off || off.ok === false) {
      return refused(`Kosmos could not confirm the window called ${p.name} after marking it, and could not take the mark off. Restart that window, or ask for help, before messaging it.`);
    }
    return refused(`Kosmos could not confirm the window called ${p.name} after marking it, so it took the mark off again and nothing was linked.`);
  }
  return { outcome: OUTCOME.LINKED, session: p.session, name: p.name };
}

module.exports = { OUTCOME, plan, link, setRunner };

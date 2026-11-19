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
/* The same tmux the board's look used (status.boardTmux), so the window it listed is the one this reaches. */
function tmuxBin() { return status.boardTmux(); }
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
  /* A mark that names something else (a session renamed with its old mark, or another tool's value): not "already
     linked" (the board still cannot confirm it), and not overwritten blindly either. */
  const foreign = mine.find((p) => String(p.claim || '').trim());
  if (foreign) return refused(`The window called ${clean} carries a mark naming ${String(foreign.claim).trim()}, so Kosmos did not change it.`);
  /* What runs in it first: the board never counts an unmarked Codex (or Antigravity, Grok) window as an agent at all
     (status.isFleetSession), so asking isAgentSession first would tell that person "no agent is running", which is
     false. status.onePanePerSession keeps one ranked pane per board NAME (so `zara` and `zara-discord` are one), and
     the already-linked check above ran over every pane carrying the name before that choice mattered. */
  const pane = status.onePanePerSession(mine)[0] || mine[0];
  /* The mark covers the whole tmux session, and a supervisor later closes a marked session none of whose panes is an
     agent (bin/agent-supervisor.sh): an editor or shell in another window of it would go too. So only a session whose
     one pane is the agent is linked. */
  const sessionPanes = (Array.isArray(panes) ? panes : []).filter((x) => x && x.session === pane.session);
  if (sessionPanes.length > 1) {
    return refused(`The window called ${clean} shares its session with ${sessionPanes.length - 1} other window${sessionPanes.length === 2 ? '' : 's'}, which Kosmos could close along with it later, so it was not linked. Close the others first.`);
  }
  if (!status.isClaudeCommand(pane.command)) {
    return refused(`The window called ${clean} is running ${pane.command || 'nothing we can name'}, not Claude. Only a Claude window can be linked for now.`);
  }
  /* And it must look like an agent to the board: a native version string always does; an unmarked `node`, or the
     legacy `claude` / `claude.exe` names, never do (the board gives such a window no card), and are refused here. */
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
  /* `=session:W.P` names exactly the pane plan() checked. Measured on tmux 3.6a: `=zara` does not resolve as an
     option or message target, `=zara:` does, and never reaches `zarah`. */
  const named = `=${p.session}:`;
  const paneOf = /^\d+\.\d+$/.test(String(p.pane || '')) ? p.pane : '';
  const lookAt = (target) => {
    const r = run(['display-message', '-p', '-t', target, '#{session_id}\t#{session_windows}x#{window_panes}\t#{pane_current_command}\t#{@kosmos_agent}']);
    const line = r && r.ok !== false ? String(r.stdout || '').replace(/\n$/, '') : '';
    const parts = line.split('\t');
    // The mark is the last field and joins the rest, so a value holding a tab is read whole, never as empty.
    return { id: parts[0] || '', panes: parts[1] || '', cmd: parts[2] || '', claim: parts.slice(3).join('\t').trim() };
  };
  const before = lookAt(named + paneOf);
  if (before.claim) {
    return paneSessionIsOurs(p.session, before.claim)
      ? refused(`${p.name}'s window is already linked to Kosmos.`)
      : refused(`The window called ${p.name} carries a mark naming ${before.claim}, so Kosmos did not change it.`);
  }
  /* The very program the board saw (plan() vetted it as an agent), not merely a command that could be Claude: an
     unmarked `node` that replaced it since the board's look must not pass. */
  /* One window with one pane (measured on tmux 3.6a: there is no session_panes; session_windows and window_panes are
     real), as plan() required, at the look and again after the mark: a window or split added meanwhile would be
     covered by the mark too. */
  if (!/^\$\d+$/.test(before.id) || before.panes !== '1x1' || before.cmd !== String(p.command || '') || !status.isClaudeCommand(before.cmd)) {
    return refused(`Kosmos could not confirm what runs in the window called ${p.name}, so nothing was linked.`);
  }
  /* From here on the SESSION ID is the target, not the name. Measured: once that session is gone, `$id` answers "no
     such session" and a new session under the name is never marked. So a window replaced after the look cannot be
     marked at all, and taking a mark off can only touch the session this call marked. */
  const byId = before.id;
  const set = run(['set-option', '-t', byId, '@kosmos_agent', p.session]);
  if (!set || set.ok === false) return refused(`Kosmos could not mark the window called ${p.name}. Nothing was changed.`);
  const read = run(['show-options', '-v', '-t', byId, '@kosmos_agent']);
  const now = read && read.ok !== false ? String(read.stdout || '').trim() : '';
  const after = lookAt(byId + (paneOf ? ':' + paneOf : ''));
  if (now !== p.session || after.id !== before.id || after.panes !== '1x1' || after.cmd !== before.cmd) {
    const off = run(['set-option', '-u', '-t', byId, '@kosmos_agent']);
    if (!off || off.ok === false) {
      return refused(`Kosmos could not confirm the window called ${p.name} after marking it, and could not take the mark off. Restart that window, or ask for help, before messaging it.`);
    }
    return refused(`Kosmos could not confirm the window called ${p.name} after marking it, so it took the mark off again and nothing was linked.`);
  }
  return { outcome: OUTCOME.LINKED, session: p.session, name: p.name };
}

module.exports = { OUTCOME, plan, link, setRunner };

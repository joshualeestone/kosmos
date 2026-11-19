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
 *   - the program in it names no agent runner (a shell after a crash, an editor);
 *   - for a Claude window, the board would not count it as an agent (status.isAgentSession: a bare `node`, the legacy
 *     `claude` names);
 *   A Codex, Antigravity or Grok window (kosmos#8724 item 3) is linked only when its program names that runner exactly
 *   and Kosmos's own record of the agent (its profile's provider) says it runs on it; its runner is then recorded too
 *   (`@kosmos_runner`, as the supervisor records it), because an empty runner reads as Claude and would route it
 *   through the wrong classifier. Anything else (a bare `node`, which the npm codex and every dev server front as)
 *   is refused with a reason, not linked wrongly.
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

/* kosmos#8724 item 3: the runner a window's program names, by the same literal lists the board and the supervisor use
   (status.js; bin/agent-supervisor.sh's adopt allowlist), or null when it names none. */
function runnerOfCommand(command) {
  if (status.isClaudeCommand(command)) return 'claude';
  if (status.isCodexCommand(command)) return 'codex';
  if (status.isAntigravityCommand(command)) return 'antigravity';
  if (status.isGrokCommand(command)) return 'grok';
  return null;
}
const RUNNER_WORD = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity', grok: 'Grok', gemini: 'Gemini', muse: 'Muse' };
const aOrAn = (w) => (/^[AEIOU]/.test(w) ? 'an ' : 'a ') + w;

/* What Kosmos's record of the agent says it runs on (create.providerRunner, the one provider -> runner map), or null
   when Kosmos has no record of it. Loaded here, not at the top, so this module stays light for its callers. */
let expectedSource = null;   // tests: (name) -> runner | null
function setExpectedSource(fn) { expectedSource = typeof fn === 'function' ? fn : null; }
function expectedRunner(name) {
  if (expectedSource) return expectedSource(name);
  try {
    /* store.readProfile answers {} for a missing record and for one it cannot parse alike, so both read as none. */
    const prof = require('./store').readProfile(name) || {};
    if (!Object.keys(prof).length) return null;
    /* A record that names no provider (some imports cannot tell) is not a record that says Claude, though
       providerRunner floors it there: said as unstated, so no refusal claims what the record never said. */
    if (!prof.provider) return 'unstated';
    return require('./create').providerRunner(prof.provider);
  } catch { return undefined; }   // the record could not be read at all: never taken for "no record"
}

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
  const runner = runnerOfCommand(pane.command);
  if (!runner) {
    return refused(`The window called ${clean} is running ${pane.command || 'nothing we can name'}, which Kosmos cannot tell is an agent, so it was not linked.`);
  }
  /* kosmos#8724 item 3: the program must agree with Kosmos's record of the agent, whichever runner it is. A Claude window
     with no record links as it always has (a window started by hand usually has none); one whose record names another
     runner is refused, because a launch job written later records THAT runner on the window and the board would read
     a live Claude window as something else. */
  const expected = expectedRunner(clean);
  if (expected === undefined) return refused(`Kosmos could not read its record of ${clean}, so it was not linked.`);
  /* A runner mark the board's look already shows, for any runner: the act would refuse it, so the preview does too. */
  const shownRunner = String(pane.runner || '').trim();
  if (shownRunner && shownRunner !== runner) return refused(`The window called ${clean} carries a runner mark naming ${shownRunner}, so Kosmos did not change it.`);
  const word = (r) => RUNNER_WORD[r] || r;
  if (runner === 'claude') {
    /* And it must look like an agent to the board: a native version string always does; an unmarked `node`, or the
       legacy `claude` / `claude.exe` names, never do (the board gives such a window no card), and are refused here. */
    if (!status.isAgentSession(pane)) return refused(`Kosmos cannot tell that the window called ${clean} is running an agent, so it was not linked.`);
    if (expected && expected !== 'claude' && expected !== 'unstated') {
      return refused(`The window called ${clean} is running Claude, but Kosmos knows ${clean} as ${aOrAn(word(expected))} agent, so it was not linked.`);
    }
  } else if (expected === 'unstated') {
    return refused(`The window called ${clean} is running ${word(runner)}, but Kosmos's record of ${clean} does not say which program it runs, so it was not linked.`);
  } else if (expected !== runner) {
    return refused(`The window called ${clean} is running ${word(runner)}, but `
      + (expected ? `Kosmos knows ${clean} as ${aOrAn(word(expected))} agent, so it was not linked.`
        : `Kosmos has no record of an agent called ${clean} that it can read, so it was not linked. Add ${clean} to Kosmos first (in Kosmos, "Import an agent you already have").`));
  }
  return { ok: true, session: pane.session, pane: pane.pane, name: clean, command: pane.command, runner };
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
    /* kosmos#8724 item 3: the runner mark is read in the same look, just before the mark, whatever its word. */
    const r = run(['display-message', '-p', '-t', target, '#{session_id}\t#{session_windows}x#{window_panes}\t#{pane_current_command}\t#{@kosmos_runner}\t#{@kosmos_agent}']);
    const line = r && r.ok !== false ? String(r.stdout || '').replace(/\n$/, '') : '';
    const parts = line.split('\t');
    // The mark is the last field and joins the rest, so a value holding a tab is read whole, never as empty.
    return { id: parts[0] || '', panes: parts[1] || '', cmd: parts[2] || '', runner: (parts[3] || '').trim(), claim: parts.slice(4).join('\t').trim() };
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
  /* A runner mark for another program, read at the look itself: a Claude window keeps none but claude, and any other
     runner keeps only its own (the board trusts this mark over the command once the window is ours). */
  if (before.runner && before.runner !== p.runner) {
    return refused(`The window called ${p.name} carries a runner mark naming ${before.runner}, so Kosmos did not change it.`);
  }
  if (!/^\$\d+$/.test(before.id) || before.panes !== '1x1' || before.cmd !== String(p.command || '') || runnerOfCommand(before.cmd) !== p.runner) {
    return refused(`Kosmos could not confirm what runs in the window called ${p.name}, so nothing was linked.`);
  }
  /* From here on the SESSION ID is the target, not the name. Measured: once that session is gone, `$id` answers "no
     such session" and a new session under the name is never marked. So a window replaced after the look cannot be
     marked at all, and taking a mark off can only touch the session this call marked. */
  const byId = before.id;
  /* kosmos#8724 item 3: a Codex, Antigravity or Grok window gets its runner recorded FIRST, so the board never sees it
     marked ours with an empty runner (which reads as Claude). A runner mark the look showed naming something else is
     refused above; one already naming this runner is kept (and never taken off below). tmux has no compare-and-set,
     so a value written by someone else between the look and this write is not detected until the read-back. */
  const withRunner = !!p.runner && p.runner !== 'claude';
  let runnerSetHere = false;
  /* -q, measured on tmux 3.6a: an option that is not set answers empty and succeeds (without -q it fails, "invalid
     option"), so a read that does fail (null: no server, a tmux that cannot answer) is told apart from no mark. A
     session that is gone also answers empty under -q; the set that follows then fails, so nothing is written. */
  const readRunner = () => {
    const r = run(['show-options', '-q', '-v', '-t', byId, '@kosmos_runner']);
    return r && r.ok !== false ? String(r.stdout || '').trim() : null;
  };
  if (withRunner) {
    const was = before.runner;   // read at the look; one naming another runner was refused above
    if (!was) {
      const setR = run(['set-option', '-t', byId, '@kosmos_runner', p.runner]);
      if (!setR || setR.ok === false) {
        /* A set that reports failure may still have applied, as for the agent mark below: what reads back as this
           call's own value is taken off (it was empty at the look), anything else is left alone. */
        if (readRunner() === p.runner) run(['set-option', '-u', '-t', byId, '@kosmos_runner']);
        return refused(`Kosmos could not record which program runs the window called ${p.name}, so nothing was linked.`);
      }
      runnerSetHere = true;
    }
  }
  const unsetRunner = () => (runnerSetHere ? run(['set-option', '-u', '-t', byId, '@kosmos_runner']) : { ok: true });
  const set = run(['set-option', '-t', byId, '@kosmos_agent', p.session]);
  if (!set || set.ok === false) {
    /* A set that reports failure may still have applied (a tmux that answered late): look before taking the runner
       note off, so a window marked ours never loses its runner. */
    const took = run(['show-options', '-q', '-v', '-t', byId, '@kosmos_agent']);
    const mark = took && took.ok !== false ? String(took.stdout || '').trim() : null;
    /* Another writer's mark (it was empty at the look) is not this call's to take off: refused as any foreign mark. */
    if (mark !== null && mark !== '' && mark !== p.session) {
      return refused(`The window called ${p.name} carries a mark naming ${mark}, so Kosmos did not change it.`
        + (runnerSetHere ? ' A note of which program runs it, which Kosmos had just written, stayed on the window.' : ''));
    }
    if (mark !== '') {
      const offA = mark === null ? null : run(['set-option', '-u', '-t', byId, '@kosmos_agent']);
      if (!offA || offA.ok === false) {
        return { ...refused(`Kosmos could not confirm whether it marked the window called ${p.name}, and could not make sure the mark is off. Restart that window, or ask for help, before messaging it.`), markLeft: true };
      }
    }
    const offR = unsetRunner();
    if (!offR || offR.ok === false) {
      /* Not marked ours, so Kosmos still will not type into it; only the note of its program stayed. */
      return refused(`Kosmos could not mark the window called ${p.name}, and could not take back the note of which program runs it. The window is not linked.`);
    }
    return refused(`Kosmos could not mark the window called ${p.name}. Nothing was changed.`);
  }
  const read = run(['show-options', '-v', '-t', byId, '@kosmos_agent']);
  const now = read && read.ok !== false ? String(read.stdout || '').trim() : '';
  const runnerNow = withRunner ? readRunner() : '';
  const after = lookAt(byId + (paneOf ? ':' + paneOf : ''));
  if (now !== p.session || (withRunner && runnerNow !== p.runner) || after.id !== before.id || after.panes !== '1x1' || after.cmd !== before.cmd) {
    const offAgent = run(['set-option', '-u', '-t', byId, '@kosmos_agent']);
    /* The runner note comes off only once the agent mark has: a window still marked ours keeps its runner, or the
       board would read it as Claude (the state the runner-first order exists to prevent). */
    /* And only a runner note that is still this call's (or empty): another writer's value read back is left alone. */
    const runnerOurs = !withRunner || runnerNow === p.runner || runnerNow === '' || runnerNow === null;   // null: unread, still ours
    const offRunner = (!offAgent || offAgent.ok === false || !runnerOurs) ? { ok: true } : unsetRunner();
    /* Only the agent mark makes the window Kosmos's, so only it failing to come off is the mark left on the window
       (markLeft). A runner note left behind alone is said, not alarmed about. */
    const off = offAgent;
    if (off && off.ok !== false && after.id && (!offRunner || offRunner.ok === false)) {
      return refused(`Kosmos could not confirm the window called ${p.name} after marking it, so it took the mark off again and nothing was linked. A note of which program runs it stayed on the window, which does not make it Kosmos's.`);
    }
    /* The session itself gone (the after-look read no id): nothing marked is left, so no alarm. */
    if (!after.id && (!off || off.ok === false)) return refused(`The window called ${p.name} went away while Kosmos was linking it, so nothing was linked.`);
    if (!off || off.ok === false) {
      /* kosmos#8724 item 2: the one refusal after which the mark may still be on the session, said as a field so a
         caller (the CLI's exit status) need not read the sentence. */
      return { ...refused(`Kosmos could not confirm the window called ${p.name} after marking it, and could not take the mark off. Restart that window, or ask for help, before messaging it.`), markLeft: true };
    }
    return refused(`Kosmos could not confirm the window called ${p.name} after marking it, so it took the mark off again and nothing was linked.`
      + ((!offRunner || offRunner.ok === false) ? ' A note of which program runs it stayed on the window, which does not make it Kosmos\'s.' : ''));
  }
  return { outcome: OUTCOME.LINKED, session: p.session, name: p.name, ...(withRunner ? { runner: p.runner } : {}) };
}

module.exports = { OUTCOME, plan, link, setRunner, setExpectedSource, runnerOfCommand };

'use strict';
/**
 * #3939 slice 2: one Muse Code turn, engine side only. Not wired into agent creation yet (a later
 * slice); nothing on any page calls it.
 *
 * What the research on card #3939 measured (Homer's Windows captures, Angel's Mac run):
 *   - `muse exec --json` streams JSONL on stdout, one event per line. The answer arrives as
 *     `run.output.delta` events (payload.text) and a final `run.terminal.completed` (payload.text,
 *     payload.terminal). Every event carries the session in `stream.id` when `stream.kind` is
 *     "session"; `run.model.configured` names the model (payload.model_id).
 *   - A session is pinned to its workspace: a turn without `--workspace` refuses to resume. So every
 *     turn passes `--workspace`.
 *   - Muse refused a data folder whose path ran through a symlink (/tmp on macOS is one); the
 *     workspace is resolved to its real path first as a precaution (only the data folder was measured).
 *   - Two turns on one session at once: the second exits 1 ("already in use"). Different sessions
 *     run side by side.
 *   - `muse exec` writes a session register in the REAL ~/Library/Application Support/Muse whatever
 *     HOME says, so this module never overrides HOME (it passes the environment through unchanged).
 *
 * Every run goes through the live-execution gate (CLAUDE.md convention 3), is stopped with SIGKILL at
 * its timeout, and has a hard-cap timer of its own, so runTurn() never hangs and never rejects.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const musestatus = require('./musestatus');

/* A coding turn can take minutes (Homer's measured turns: 25 to 47 s). Past this, Kosmos stops it. */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;
/* Our own backstop past the timeout, in case the child outlives even the SIGKILL wait. */
const TURN_HARD_CAP_MS = TURN_TIMEOUT_MS + 30 * 1000;
/* Homer's 80-event turn was well under a megabyte; a turn far past this is not one Kosmos reads whole. */
const TURN_MAX_BUFFER = 16 * 1024 * 1024;
/* The approval modes Muse takes (`--approval-mode`); anything else is refused before a run. */
const APPROVAL_MODES = Object.freeze(['untrusted', 'on-request', 'never']);
const DEFAULT_APPROVAL_MODE = 'on-request';   // Muse's own default: it asks before acting
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COULD_NOT_RUN = 'Kosmos could not run Muse Code just now';
const TIMED_OUT = 'Muse Code did not finish the turn in time';
const NOT_WIRED_UP = 'Muse Code is not wired up on this computer yet';
const STOPPED = 'Stopped before Muse Code finished';

/**
 * The arguments for one turn, or { error } when an input is not one Kosmos will hand Muse.
 * `--trust-workspace`: the agent's folder is Kosmos's own, and Muse reads its AGENTS.md project rules
 * only in a trusted workspace. `--no-foreign-personal-context`: keeps other tools' personal rules out
 * (weakest premise: not yet observed what it excludes; the signed-in Mac run should confirm).
 * `--user-input-auto-resolve`: headless, so a question to the user is cancelled rather than waited on.
 */
function turnArgs({ workspace, sessionId, prompt, approvalMode } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'there is nothing to send' };
  if (!UUID_RE.test(String(sessionId || ''))) return { error: 'the session id is not one Muse takes' };
  const mode = approvalMode || DEFAULT_APPROVAL_MODE;
  if (!APPROVAL_MODES.includes(mode)) return { error: 'that approval mode is not one Muse takes' };
  // Absolute only (round 1): a relative path would resolve against the board's own folder.
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) return { error: 'the agent\'s folder is not there' };
  let real;
  try { real = fs.realpathSync(workspace); } catch { return { error: 'the agent\'s folder is not there' }; }
  try { if (!fs.statSync(real).isDirectory()) return { error: 'the agent\'s folder is not a folder' }; } catch { return { error: 'the agent\'s folder is not there' }; }
  return {
    args: ['exec', '--json', '--workspace', real, '--session-id', String(sessionId), '--approval-mode', mode,
      '--trust-workspace', '--no-foreign-personal-context', '--user-input-auto-resolve', '--', prompt],
    workspace: real,
  };
}

/**
 * What a turn's JSONL says: { sessionId, model, text, done, terminal, events, unreadable }.
 * `text` is the final answer when the turn completed, else the deltas joined; a line that is not JSON
 * is counted, never guessed at.
 */
function parseEvents(jsonl) {
  const out = { sessionId: null, model: null, text: '', done: false, terminal: null, events: 0, unreadable: 0 };
  let deltas = '';
  for (const line of String(jsonl || '').split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { out.unreadable += 1; continue; }
    if (!ev || typeof ev !== 'object') { out.unreadable += 1; continue; }
    out.events += 1;
    if (!out.sessionId && ev.stream && ev.stream.kind === 'session' && typeof ev.stream.id === 'string') out.sessionId = ev.stream.id;
    const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
    if (ev.payload_type === 'run.model.configured' && typeof p.model_id === 'string') out.model = p.model_id;
    else if (ev.payload_type === 'run.output.delta' && typeof p.text === 'string') deltas += p.text;
    else if (ev.payload_type === 'run.terminal.completed') {
      if (p.terminal !== undefined) out.terminal = p.terminal;
      // Finished only when Muse says the run COMPLETED (round 1): another terminal state is not done.
      out.done = p.terminal === 'completed';
      if (out.done && typeof p.text === 'string') out.text = p.text;
    }
  }
  if (!out.text) out.text = deltas;
  return out;
}

let runMuse = (bin, args, opts, done) => {
  const gate = require('./live-execution');
  // The prompt is the person's words: never in a log line (round 1).
  if (!gate.liveExecutionAllowed()) { gate.refuseOrWarn('muserun', bin, args.slice(0, -1).concat('<prompt>')); done(new Error('live execution is off')); return () => {}; }
  /* Round 1: its own process group (detached), so a timeout stops the launcher AND anything it started
     (a launcher that does not exec its binary would otherwise leave Muse editing the folder); input
     closed, as in every research run; output capped. The environment passes through untouched. */
  let child;
  try { child = spawn(bin, args, { cwd: opts.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { done(e); return () => {}; }
  const outChunks = []; const errChunks = []; let bytes = 0; let over = false; let killed = false; let finished = false; let exited = false;
  /* Round 3: once the launcher has exited, its group number is no longer ours to signal. A helper that
     left the group can still hold the output open, and by then the number may have been reused by
     some other process on this shared Mac. So after the exit, stopping means dropping the output
     (which ends the turn), never a signal to -pid. (POSIX; runTurn refuses anything but a Mac.) */
  child.on('exit', () => { exited = true; });
  const killGroup = () => {
    killed = true;
    if (exited) { try { child.stdout.destroy(); child.stderr.destroy(); } catch { /* gone */ } return; }
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  };
  const timer = setTimeout(killGroup, turnTimeoutMs);
  // Raw bytes, not string length (round 2): the cap is what the comment says it is.
  const take = (which) => (buf) => {
    if (over) return;
    bytes += buf.length;
    (which === 'out' ? outChunks : errChunks).push(buf);
    if (bytes > maxBytes) { over = true; killGroup(); }
  };
  child.stdout.on('data', take('out')); child.stderr.on('data', take('err'));
  /* Round 2: an unlistened 'error' on a stream crashes the whole board (engine/fedseats.js guards the same). */
  child.stdout.on('error', () => {}); child.stderr.on('error', () => {});
  const text = (chunks) => Buffer.concat(chunks).toString('utf8');
  const end = (e) => { if (finished) return; finished = true; clearTimeout(timer); done(e, text(outChunks), text(errChunks)); };
  child.on('error', (e) => end(e));
  child.on('close', (code, signal) => {
    if (code === 0 && !killed) { end(null); return; }
    const e = new Error('muse exited ' + (code === null ? 'on ' + signal : code));
    e.code = code; e.signal = signal; e.killed = killed; e.overflow = over;
    end(e);
  });
  // Round 2: the caller's hard cap can stop the group too, rather than leave it running behind an answer.
  return () => { if (!finished) killGroup(); };
};

/**
 * Run one turn. Promise of { ok, exitCode, sessionId, model, text, done, because }: never rejects.
 * `ok` means Muse exited 0 AND the turn completed; anything else says why, in words.
 */
function runTurn(input) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(cap); resolve(r); };
    const fail = (because) => finish({ ok: false, exitCode: null, sessionId: null, model: null, text: '', done: false, because });
    let stop = null;
    const cap = setTimeout(() => { if (stop) { try { stop(); } catch { /* best effort */ } } fail(TIMED_OUT); }, hardCapMs);
    if (cap.unref) cap.unref();
    /* #3939 3c-3a: the caller (engine/musefront.js) can end the turn: the Stop button, or its pane closing.
       It gets a function that stops the Muse group and answers STOPPED. */
    if (input && typeof input.onStop === 'function') {
      try { input.onStop(() => { if (settled) return; if (stop) { try { stop(); } catch { /* best effort */ } } fail(STOPPED); }); }
      catch { /* a caller that throws here does not get to stop the turn */ }
    }
    try {
      // Round 3: the AGENT_WORKFORCE_MUSE_BIN override is honoured on any platform, and the stop above is POSIX.
      if (platform !== 'darwin') { fail(NOT_WIRED_UP); return; }
      const inst = musestatus.installed();
      if (!inst.installed) { fail(inst.because); return; }
      const t = turnArgs(input);
      if (t.error) { fail(t.error); return; }
      // #3939 3c-1: when this turn began, so a refusal does not undo a sign-in made while it ran.
      const startedAt = Date.now();
      const atStart = musestatus.fileAtStart();   // the credential this turn begins with (round 5)
      stop = runMuse(inst.bin, t.args, { cwd: t.workspace }, (err, stdout, stderr) => {
        const parsed = parseEvents(stdout);
        const exitCode = err ? (typeof err.code === 'number' ? err.code : null) : 0;
        let because = null;
        // Kosmos's own stop first (round 3): stderr from a turn Kosmos stopped does not say why it ended.
        if (err && err.overflow) because = 'Muse Code said more than Kosmos reads in one turn';
        else if (err && err.killed) because = TIMED_OUT;
        else if (err && /already in use/.test(String(stderr || ''))) because = 'Muse Code is still working on this agent\'s last turn';
        // Singular and plural both appear in the captures (round 1).
        else if (err && /missing meta credential/.test(String(stderr || ''))) {
          because = 'Muse Code is not signed in on this computer';
          // #3939 slice 3c-1: from now on GET /api/muse says so too, until a sign-in or a completed
          // turn after this. It never throws, and the turn's answer does not depend on it.
          musestatus.markSignedOut(startedAt, atStart, Date.now());
        }
        // Timed out only when Kosmos stopped it (round 1): another signal is a crash, not a timeout.
        else if (err) because = COULD_NOT_RUN;
        else if (!parsed.done) because = 'Muse Code stopped before finishing the turn';
        // #3939 3c-1: a completed turn proves the sign-in (a terminal `muse login` is seen only this way).
        if (!err && parsed.done) musestatus.markTurnSignedIn(startedAt);
        finish({ ok: !err && parsed.done, exitCode, sessionId: parsed.sessionId, model: parsed.model, text: parsed.text, done: parsed.done, because });
      });
    } catch {
      fail(COULD_NOT_RUN);
    }
  });
}

let turnTimeoutMs = TURN_TIMEOUT_MS;
let hardCapMs = TURN_HARD_CAP_MS;
let maxBytes = TURN_MAX_BUFFER;
let platform = process.platform;
const REAL = { runMuse };
function setForTests(o) {
  if (o && o.runMuse) runMuse = o.runMuse;
  if (o && o.turnTimeoutMs) turnTimeoutMs = o.turnTimeoutMs;
  if (o && o.hardCapMs) hardCapMs = o.hardCapMs;
  if (o && o.maxBytes) maxBytes = o.maxBytes;
  if (o && o.platform) platform = o.platform;
}
function resetForTests() { runMuse = REAL.runMuse; turnTimeoutMs = TURN_TIMEOUT_MS; hardCapMs = TURN_HARD_CAP_MS; maxBytes = TURN_MAX_BUFFER; platform = process.platform; }

module.exports = { turnArgs, parseEvents, runTurn, APPROVAL_MODES, TURN_TIMEOUT_MS, TURN_HARD_CAP_MS, TIMED_OUT, COULD_NOT_RUN, NOT_WIRED_UP, STOPPED, setForTests, resetForTests };

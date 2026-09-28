'use strict';
/**
 * #3939 slice 3c-3a: what runs in a Meta Muse agent's tmux pane.
 *
 * Every other runner puts the vendor's own terminal program in the pane. Muse's is not one Kosmos
 * can read from outside (the card's spike: its screen does not read back), and Meta's headless route
 * is one `muse exec` per turn. So the pane runs this instead: it takes each message the board types
 * into the pane and runs ONE Muse turn for it through engine/muserun.runTurn, on this agent's own
 * session, and prints the answer. Delivery, restart, stop and logs are the ordinary tmux ones.
 *
 * Input is read in RAW mode. engine/chat.js always types a message as ONE line (its whitespace is
 * flattened, #3419) and then presses Enter separately, so one carriage return ends one message.
 * Cooked mode would not do: macOS cuts a cooked line at 1024 bytes, and a Kosmos message can be longer.
 *
 * Turns run one at a time, in the order the messages came. Muse refuses a second turn on a session
 * that is still busy, so a message typed during a turn waits for it.
 *
 * The board hears working when a turn starts and idle when it ends, through bin/agy-report-bridge.js
 * (its PreInvocation and Stop events map to exactly those two states, and it already carries the
 * board token, the world header, the per-pane throttle and the never-break-the-agent contract).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROMPT = '> ';
const HELLO = 'Meta Muse, run by Kosmos. Messages typed here go to Muse one turn at a time.';

/** Where this agent's Muse session id is kept, inside its own folder. */
function sessionFile(workspace) { return path.join(workspace, '.kosmos', 'muse-session'); }

/**
 * This agent's session id: the one kept in its folder, or a new one written there. { id, note } where
 * note says, in words, when a new one had to be made over an unreadable one. Never throws: if the id
 * cannot be written the agent still runs, on a session that lasts until the front restarts.
 */
function loadSession(workspace, o = {}) {
  const file = sessionFile(workspace);
  const make = o.randomUUID || crypto.randomUUID;
  let note = null;
  try {
    const kept = fs.readFileSync(file, 'utf8').trim();
    if (UUID_RE.test(kept)) return { id: kept, note: null };
    note = 'The saved Muse session could not be read, so this agent starts a new one.';
  } catch (e) {
    if (e && e.code !== 'ENOENT') note = 'The saved Muse session could not be read, so this agent starts a new one.';
  }
  const id = make();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, id + '\n', { mode: 0o600 });
  } catch {
    note = 'Kosmos could not save this agent\'s Muse session, so a restart will start a new one.';
  }
  return { id, note };
}

/**
 * The front's logic, with its edges passed in so a test can drive it:
 *   runTurn(input) -> Promise of muserun's result; report(state) -> fire and forget;
 *   write(text) -> the pane.
 * Returns { feed(bytes), drained() }. feed takes raw input; drained resolves once no turn is queued
 * or running (tests only).
 */
function createFront({ workspace, sessionId, runTurn, report, write }) {
  let line = '';
  const queue = [];
  let running = false;
  let waiters = [];

  const settle = () => { if (!running && !queue.length) { const w = waiters; waiters = []; w.forEach((f) => f()); } };

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const prompt = queue.shift();
        report('working');
        let r;
        try { r = await runTurn({ workspace, sessionId, prompt, approvalMode: 'never' }); }
        catch { r = { ok: false, text: '', because: 'Kosmos could not run Muse Code just now' }; }
        const text = r && typeof r.text === 'string' ? r.text.trim() : '';
        if (text) write(text + '\n');
        if (!r || !r.ok) write('(' + ((r && r.because) || 'Muse Code did not finish the turn') + ')\n');
        // Idle only once nothing is waiting: a queued message starts its turn at once.
        if (!queue.length) report('idle');
        write(PROMPT);
      }
    } finally {
      running = false;
      settle();
    }
  }

  function submit() {
    const text = line.trim();
    line = '';
    write('\n');
    if (!text) { write(PROMPT); return; }
    queue.push(text);
    if (running) write('(queued: Muse is still on the last message)\n');
    pump();
  }

  // An escape sequence (an arrow key, a paste bracket): 0 = none, 1 = after ESC, 2 = inside ESC [ ...
  let esc = 0;

  function feed(chunk) {
    const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    for (const ch of s) {
      if (esc === 1) { esc = (ch === '[' || ch === 'O') ? 2 : 0; continue; }
      if (esc === 2) { if (ch >= '@' && ch <= '~') esc = 0; continue; }   // the final byte ends it
      if (ch === '\u001b') { esc = 1; continue; }   // never part of a message
      if (ch === '\r' || ch === '\n') { submit(); continue; }
      if (ch === '\u0003' || ch === '\u0015') {   // Ctrl+C, Ctrl+U: drop the line being typed
        if (line) write('\n' + PROMPT);
        line = '';
        continue;
      }
      if (ch === '\u007f' || ch === '\b') {   // Backspace
        if (line) { line = Array.from(line).slice(0, -1).join(''); write('\b \b'); }
        continue;
      }
      if (ch < ' ') continue;         // other control bytes are never part of a message
      line += ch;
      write(ch);
    }
  }

  function drained() {
    return new Promise((resolve) => { waiters.push(resolve); settle(); });
  }

  return { feed, drained };
}

/** Tell the board working or idle, through the agy bridge beside the engine. Never throws or waits. */
function makeReporter(o = {}) {
  const spawn = o.spawn || require('node:child_process').spawn;
  // The supervisor passes the bridge beside itself (in an install that is not beside the engine).
  const env = o.env || process.env;
  const bridge = o.bridge || env.KOSMOS_MUSE_BRIDGE || path.join(__dirname, '..', 'bin', 'agy-report-bridge.js');
  const EVENT = { working: 'PreInvocation', idle: 'Stop' };
  return (state) => {
    const ev = EVENT[state];
    if (!ev) return;
    try {
      const child = spawn(o.node || process.execPath, [bridge, ev], { stdio: ['pipe', 'ignore', 'ignore'], env });
      child.on('error', () => { /* a missed report must never stop a turn */ });
      if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end('{}'); }
      if (child.unref) child.unref();
    } catch { /* same */ }
  };
}

function main(argv = process.argv) {
  const workspace = argv[2];
  const write = (t) => { try { process.stdout.write(t); } catch { /* the pane went away */ } };
  if (!workspace || !path.isAbsolute(workspace)) {
    write('Kosmos could not start Muse: it was not told which folder this agent works in.\n');
    process.exitCode = 2;
    return;
  }
  /* Running Muse is this process's whole job, so it states that intent here, on the real-start path
     only, as server.js does (engine/live-execution.js). Without it every turn was refused as "live
     execution is off". Never at module load: tests require this file and must stay fail-closed. */
  require('./live-execution').allowLiveExecution();
  const { id, note } = loadSession(workspace);
  write(HELLO + '\n');
  if (note) write(note + '\n');
  const front = createFront({ workspace, sessionId: id, runTurn: require('./muserun').runTurn, report: makeReporter(), write });
  if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.on('data', (b) => front.feed(b));
  process.stdin.on('end', () => { front.drained().then(() => process.exit(0)); });
  write(PROMPT);
}

if (require.main === module) main();

module.exports = { createFront, loadSession, sessionFile, makeReporter, UUID_RE, PROMPT, HELLO };

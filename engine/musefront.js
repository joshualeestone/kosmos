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
 * that is still busy, so a message typed during a turn waits for it. The board's Stop (one Escape)
 * ends the running turn and drops the waiting ones.
 *
 * The board hears working and idle through bin/agy-report-bridge.js (its PreInvocation and Stop
 * events map to those two states, and it carries the board token, the world header, the per-pane
 * throttle and the never-break-the-agent contract).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');

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
    fs.chmodSync(file, 0o600);   // a file that was already there keeps its old mode otherwise
  } catch {
    note = 'Kosmos could not save this agent\'s Muse session, so a restart will start a new one.';
  }
  return { id, note };
}

/** While a turn runs, working is said again this often, so a long turn never reads as stale on the board. */
const WORKING_EVERY_MS = 60 * 1000;

/**
 * The front's logic, with its edges passed in so a test can drive it:
 *   runTurn(input) -> Promise of muserun's result; report(state) -> fire and forget;
 *   write(text) -> the pane.
 * Returns { feed(bytes), stop(), drained() }. feed takes raw input; stop ends the running turn and drops
 * the waiting ones; drained resolves once no turn is queued or running (tests only).
 */
function createFront({ workspace, sessionId, runTurn, report, write, workingEveryMs = WORKING_EVERY_MS }) {
  let line = '';
  const queue = [];
  let running = false;
  let stopTurn = null;   // ends the turn that is running now, when runTurn handed one over
  let waiters = [];
  const decoder = new StringDecoder('utf8');   // a character split across two reads stays one character

  const settle = () => { if (!running && !queue.length) { const w = waiters; waiters = []; w.forEach((f) => f()); } };

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const prompt = queue.shift();
        report('working');
        const beat = setInterval(() => report('working'), workingEveryMs);
        if (beat.unref) beat.unref();
        let r;
        try { r = await runTurn({ workspace, sessionId, prompt, approvalMode: 'never', onStop: (f) => { stopTurn = f; } }); }
        catch { r = { ok: false, text: '', because: 'Kosmos could not run Muse Code just now' }; }
        finally { clearInterval(beat); stopTurn = null; }
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

  /** The board's Stop (one Escape): the line being typed, the waiting messages and the running turn all end. */
  function stop() {
    const dropped = queue.length;
    queue.length = 0;
    line = '';
    if (dropped) write('\n(' + dropped + (dropped === 1 ? ' waiting message was' : ' waiting messages were') + ' dropped)\n');
    if (stopTurn) { const f = stopTurn; stopTurn = null; try { f(); } catch { /* the turn is ending anyway */ } }
    else if (!running) write('\n' + PROMPT);
  }

  function feed(chunk) {
    const s = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
    const chars = Array.from(s);
    let echo = '';
    const flush = () => { if (echo) { write(echo); echo = ''; } };
    // An escape sequence (an arrow key) arrives whole in one read, so its state never carries into the
    // next read: an Escape on its own, at the end of a read, is the board's Stop.
    let esc = 0;   // 0 = none, 1 = after ESC, 2 = inside ESC [ ...
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (esc === 1) { esc = (ch === '[' || ch === 'O') ? 2 : 0; continue; }
      if (esc === 2) { if (ch >= '@' && ch <= '~') esc = 0; continue; }   // the final byte ends it
      if (ch === '\u001b') {
        if (i === chars.length - 1) { flush(); stop(); } else esc = 1;
        continue;
      }
      if (ch === '\r' || ch === '\n') { flush(); submit(); continue; }
      if (ch === '\u0003' || ch === '\u0015') {   // Ctrl+C, Ctrl+U: drop the line being typed
        flush();
        if (line) write('\n' + PROMPT);
        line = '';
        continue;
      }
      if (ch === '\u007f' || ch === '\b') {   // Backspace
        if (line) { line = Array.from(line).slice(0, -1).join(''); flush(); write('\b \b'); }
        continue;
      }
      if (ch < ' ') continue;         // other control bytes are never part of a message
      line += ch;
      echo += ch;
    }
    flush();
  }

  function drained() {
    return new Promise((resolve) => { waiters.push(resolve); settle(); });
  }

  return { feed, stop, drained };
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
  const report = makeReporter();
  const front = createFront({ workspace, sessionId: id, runTurn: require('./muserun').runTurn, report, write });
  /* The pane closing (a Stop agent, a restart) must not leave a turn running behind it: Muse runs in
     its own process group, which the pane's hangup never reaches, and a turn left running would hold
     this agent's session and refuse the next front's first turn. */
  const leave = () => { front.stop(); process.exit(0); };
  process.on('SIGHUP', leave);
  process.on('SIGTERM', leave);
  if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.on('data', (b) => front.feed(b));
  process.stdin.on('end', leave);
  report('idle');   // the board hears from a new agent before its first message
  write(PROMPT);
}

if (require.main === module) main();

module.exports = { createFront, loadSession, sessionFile, makeReporter, UUID_RE, PROMPT, HELLO };

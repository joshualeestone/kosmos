'use strict';

/**
 * #7412: kosmos task close takes several task numbers and closes each, from both commands (Mac install/kosmos,
 * Windows tools/windows/kosmos-cli.js), against a real board and the real task engine.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-close-many-7412.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskclosemany-cli-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const taskchat = require('./engine/taskchat');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('kai', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'CloseMany' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));   // kai is NOT on it
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const taskOf = (n) => tasks.byNumber(projects.readAll().find((p) => p.id === projectId), n);
const isDone = (n) => tasks.progressOf(taskOf(n)).closed;
const token = (name) => sendertoken.mint(name).token;

async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, text: out.concat(err).join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '', port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, text: (stdout || '') + (stderr || '') });
    });
  });
}
const BOTH = [['Windows', win], ['Mac', mac]];

const open = (label, k = 3) => Array.from({ length: k }, (_, i) => tasks.create(projectId, { sentence: 'Close many ' + label + ' ' + i, who: 'mara' }).number);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('#7412: either command closes several tasks at once and names them in one line', async () => {
  for (const [label, run] of BOTH) {
    const ns = open(label);
    const r = await run(['task', 'close', projectId, ...ns.map(String)], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\s*Closed tasks ' + ns.join(', ') + ' on ' + esc(projectId) + '\\.$', 'm'), label + ': ' + r.text);
    for (const n of ns) assert.equal(isDone(n), true, label + ': task ' + n + ' not closed');
    for (const n of ns) assert.ok(taskchat.read(projectId, n).some((x) => x.kind === 'closed'), label + ': task ' + n + ' history has no closed line');
  }
});

test('#7412: CONTROL, one number still closes one task with the one-task sentence', async () => {
  for (const [label, run] of BOTH) {
    const [a, b] = open('one ' + label, 2);
    const r = await run(['task', 'close', projectId, String(a)], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, new RegExp('Closed task ' + a + ' on ' + esc(projectId) + '\\.$', 'm'), label);
    assert.doesNotMatch(r.text, /Closed tasks/, label);
    assert.equal(isDone(b), false, label + ': a task not named was closed');
  }
});

test('#7412: one the board refuses does not stop the others; the command says which and exits 1', async () => {
  for (const [label, run] of BOTH) {
    const [a, b] = open('refused ' + label, 2);
    const r = await run(['task', 'close', projectId, String(a), '9999', String(b)], token('mara'));
    assert.equal(r.code, 1, label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\s*Closed tasks ' + a + ', ' + b + ' on ', 'm'), label + ': ' + r.text);
    assert.match(r.text, /^\s*Could not close: 9999 \(.+\)\.$/m, label + ': ' + r.text);
    assert.equal(isDone(a), true, label); assert.equal(isDone(b), true, label);
  }
});

test('#7412: when the FIRST number is refused, the rest are still closed', async () => {
  for (const [label, run] of BOTH) {
    const [a] = open('first ' + label, 1);
    const r = await run(['task', 'close', projectId, '9998', String(a)], token('mara'));
    assert.equal(r.code, 1, label + ': ' + r.text);
    assert.match(r.text, /^\s*Could not close: 9998 \(/m, label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\s*Closed task ' + a + ' on ', 'm'), label + ': one closed reads as one task: ' + r.text);
    assert.equal(isDone(a), true, label + ': ' + r.text);
  }
});

test('#7412: a number given twice is closed once and named once', async () => {
  for (const [label, run] of BOTH) {
    const [a, b] = open('twice ' + label, 2);
    const r = await run(['task', 'close', projectId, String(a), String(b), String(a)], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\s*Closed tasks ' + a + ', ' + b + ' on ' + esc(projectId) + '\\.$', 'm'), label + ': ' + r.text);
    const [c, d] = open('zero ' + label, 2);
    const z = await run(['task', 'close', projectId, String(c), '0' + c, String(d)], token('mara'));
    assert.equal(z.code, 0, label + ': ' + z.text);
    assert.match(z.text, new RegExp('^\\s*Closed tasks ' + c + ', ' + d + ' on ' + esc(projectId) + '\\.$', 'm'), label + ': 0' + c + ' is task ' + c + ': ' + z.text);
  }
});

test('#7412: a word that is not a number, an option, or --replaced-by with several numbers is refused before anything closes', async () => {
  for (const [label, run] of BOTH) {
    for (const extra of [['shipped'], ['--note', 'x'], ['--replaced-by', '5'], ['']]) {
      const [a, b] = open('bad ' + label + ' ' + extra.join(' '), 2);
      const argv = [String(a), String(b), ...extra];
      const r = await run(['task', 'close', projectId, ...argv], token('mara'));
      assert.equal(r.code, 2, label + ' ' + extra.join(' ') + ': ' + r.text);
      assert.equal(isDone(a), false, label + ' ' + extra.join(' ') + ': the first closed anyway');
      assert.equal(isDone(b), false, label + ' ' + extra.join(' ') + ': the second closed anyway');
      if (extra[0] === '--replaced-by') assert.match(r.text, /--replaced-by takes one task/, label);
    }
  }
});

test('#7412: CONTROL, --replaced-by with one number still closes it as replaced', async () => {
  for (const [label, run] of BOTH) {
    const [a, b] = open('replaced ' + label, 2);
    const r = await run(['task', 'close', projectId, String(a), '--replaced-by', String(b)], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.equal(taskOf(a).replacedBy, b, label);
  }
});

test('#7412: both usages say close takes several numbers', async () => {
  for (const [label, run] of BOTH) {
    const r = await run(['task', 'close', projectId], token('mara'));
    assert.equal(r.code, 2, label);
    assert.match(r.text, /<task-number> \[<task-number> \.\.\.\]/, label + ': ' + r.text);
  }
});

test('#7412: both commands refuse an option-shaped word after the numbers with the same words', async () => {
  const texts = {};
  for (const [label, run] of BOTH) {
    const [a, b] = open('same ' + label, 2);
    for (const w of ['--foo', '--5', '--']) {
      const r = await run(['task', 'close', projectId, String(a), String(b), w], token('mara'));
      assert.equal(r.code, 2, label + ' ' + w + ': ' + r.text);
      assert.doesNotMatch(r.text, /put -- before it/, label + ' ' + w + ': close takes no text: ' + r.text);
      (texts[w] = texts[w] || {})[label] = r.text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    }
    assert.equal(isDone(a), false, label); assert.equal(isDone(b), false, label);
  }
  for (const w of Object.keys(texts)) assert.equal(texts[w].Mac, texts[w].Windows, w + ': the two commands disagree');
});

test('#7412: a close Kosmos does not answer stops the run: the ones before are said, the rest are not tried', async () => {
  const http = require('node:http');
  for (const [label] of BOTH) {
    const [a, b, c] = open('lost ' + label);
    // A board that drops the connection on task b's close and passes everything else through to the real one.
    const proxy = http.createServer((req, res) => {
      if (req.method === 'POST' && new RegExp('/task/' + b + '/close$').test(req.url)) { req.socket.destroy(); return; }
      const up = http.request({ host: '127.0.0.1', port: server.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.statusCode = 502; res.end(); });
      req.pipe(up);
    });
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    const pbase = 'http://127.0.0.1:' + proxy.address().port;
    try {
      let r;
      const argv = ['task', 'close', projectId, String(a), String(b), String(c)];
      if (label === 'Mac') r = await mac(argv, token('mara'), proxy.address().port);
      else {
        const out = []; const err = [];
        const code = await cli.main(argv, { env: {}, url: pbase, hook: { resolveUrl: () => pbase, readBoardToken: () => null, agentToken: () => token('mara') }, out: (s) => out.push(s), err: (s) => err.push(s) });
        r = { code, text: out.concat(err).join('\n') };
      }
      assert.notEqual(r.code, 0, label + ': ' + r.text);
      assert.match(r.text, new RegExp('^\\s*Closed task ' + a + ' on ', 'm'), label + ': ' + r.text);
      assert.match(r.text, new RegExp('close task ' + b), label + ': names the one it could not confirm: ' + r.text);
      assert.match(r.text, new RegExp('^\\s*Not tried, so still open: ' + c + '\\.$', 'm'), label + ': ' + r.text);
      assert.doesNotMatch(r.text, /Could not close/, label + ': an unanswered close is not said as refused: ' + r.text);
      assert.equal(isDone(a), true, label); assert.equal(isDone(c), false, label + ': sent after an unanswered close');
    } finally {
      proxy.close();
    }
  }
});

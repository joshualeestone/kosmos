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
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 45000 }, (err, stdout, stderr) => {
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
    assert.match(r.text, /^\s*Could not close task 9999: .+\.$/m, label + ': one line for the refused task: ' + r.text);
    assert.equal(isDone(a), true, label); assert.equal(isDone(b), true, label);
  }
});

test('#7412: when the FIRST number is refused, the rest are still closed', async () => {
  for (const [label, run] of BOTH) {
    const [a] = open('first ' + label, 1);
    const r = await run(['task', 'close', projectId, '9998', String(a)], token('mara'));
    assert.equal(r.code, 1, label + ': ' + r.text);
    assert.match(r.text, /^\s*Could not close task 9998: /m, label + ': ' + r.text);
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
  const lostTexts = {};
  for (const [label] of BOTH) for (const firstLost of [false, true]) {
    const [a0, b0, c] = open('lost ' + label + ' ' + firstLost);
    // firstLost: the very first number is the one not answered.
    const [a, b] = firstLost ? [null, a0] : [a0, b0];
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
      const argv = ['task', 'close', projectId, ...(a === null ? [] : [String(a)]), String(b), String(c)];
      if (label === 'Mac') r = await mac(argv, token('mara'), proxy.address().port);
      else {
        const out = []; const err = [];
        const code = await cli.main(argv, { env: {}, url: pbase, hook: { resolveUrl: () => pbase, readBoardToken: () => null, agentToken: () => token('mara') }, out: (s) => out.push(s), err: (s) => err.push(s) });
        r = { code, text: out.concat(err).join('\n') };
      }
      assert.notEqual(r.code, 0, label + ': ' + r.text);
      if (a !== null) assert.match(r.text, new RegExp('^\\s*Closed task ' + a + ' on ', 'm'), label + ': ' + r.text);
      else assert.doesNotMatch(r.text, /Closed task/, label + ': ' + r.text);
      assert.match(r.text, new RegExp('^\\s*Task ' + b + ' may have closed anyway: check kosmos task list ', 'm'), label + ': says it may have closed: ' + r.text);
      assert.match(r.text, new RegExp('^\\s*Not tried: ' + c + '\\.$', 'm'), label + ': ' + r.text);
      assert.doesNotMatch(r.text, /Could not close/, label + ': an unanswered close is not said as refused: ' + r.text);
      if (a !== null) assert.equal(isDone(a), true, label);
      assert.equal(isDone(c), false, label + ': sent after an unanswered close');
      (lostTexts[firstLost] = lostTexts[firstLost] || {})[label] = r.text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').replace(/[0-9]+/g, 'N');
    } finally {
      proxy.close();
    }
  }
  // Review 5: the two commands say an unanswered close in the same words (not "is it running?" on one of them).
  for (const k of Object.keys(lostTexts)) assert.equal(lostTexts[k].Windows, lostTexts[k].Mac, 'firstLost=' + k + ': the two commands disagree');
});

/* Runs either command against a stand-in board at `pbase`. */
async function runVia(label, port, argv, agentToken, winFetch) {
  if (label === 'Mac') return mac(argv, agentToken, port);
  const pbase = 'http://127.0.0.1:' + port;
  const out = []; const err = [];
  const code = await cli.main(argv, { env: {}, url: pbase, ...(winFetch ? { fetch: winFetch } : {}), hook: { resolveUrl: () => pbase, readBoardToken: () => null, agentToken: () => agentToken }, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, text: out.concat(err).join('\n') };
}

test('#7412 review 4: a close whose connection is refused sent nothing, so it is named as not tried, never as maybe closed', async () => {
  const http = require('node:http');
  for (const [label] of BOTH) {
    const [a, b, c] = open('refusedconn ' + label);
    // A board that answers task a's close, then stops listening: the next connection is refused (curl 7, ECONNREFUSED).
    const proxy = http.createServer((req, res) => {
      const last = req.method === 'POST' && new RegExp('/task/' + a + '/close$').test(req.url);
      const up = http.request({ host: '127.0.0.1', port: server.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => {
        const h = { ...r.headers }; if (last) h.connection = 'close';
        res.writeHead(r.statusCode, h); r.pipe(res);
        if (last) res.on('finish', () => { proxy.close(); setImmediate(() => proxy.closeAllConnections()); });
      });
      up.on('error', () => { res.statusCode = 502; res.end(); });
      req.pipe(up);
    });
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    try {
      const r = await runVia(label, proxy.address().port, ['task', 'close', projectId, String(a), String(b), String(c)], token('mara'));
      assert.notEqual(r.code, 0, label + ': ' + r.text);
      assert.match(r.text, new RegExp('^\\s*Closed task ' + a + ' on ', 'm'), label + ': ' + r.text);
      assert.doesNotMatch(r.text, /may have closed/, label + ': nothing was sent for task ' + b + ': ' + r.text);
      assert.match(r.text, new RegExp('^\\s*Not tried: ' + b + ', ' + c + '\\.$', 'm'), label + ': ' + r.text);
      assert.equal(isDone(a), true, label); assert.equal(isDone(b), false, label); assert.equal(isDone(c), false, label);
    } finally {
      proxy.close();
    }
  }
});

test('#7412 review 4: an agent not on the project is told once, and the rest are not sent', async () => {
  for (const [label, run] of BOTH) {
    const [a, b, c] = open('notmine ' + label);
    const r = await run(['task', 'close', projectId, String(a), String(b), String(c)], token('kai'));
    assert.equal(r.code, 1, label + ': ' + r.text);
    assert.equal((r.text.match(/Could not close task/g) || []).length, 1, label + ': one refusal line, not one per task: ' + r.text);
    assert.match(r.text, new RegExp('^\\s*Could not close task ' + a + ': that agent is not on this project', 'm'), label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\s*Not tried: ' + b + ', ' + c + '\\.$', 'm'), label + ': ' + r.text);
    for (const n of [a, b, c]) assert.equal(isDone(n), false, label + ': task ' + n + ' closed by an agent not on the project');
  }
});

test('#7412 review 4: both commands keep to the board limit for closing several at once, refused before anything is sent', async () => {
  const MAX = Number(/const BULK_CLOSE_MAX = (\d+);/.exec(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'))[1]);
  assert.ok(MAX > 1, 'read the board limit');
  for (const [label, run] of BOTH) {
    const [a] = open('cap ' + label, 1);
    const over = await run(['task', 'close', projectId, ...Array(MAX + 1).fill(String(a))], token('mara'));
    assert.equal(over.code, 2, label + ': ' + over.text);
    assert.match(over.text, new RegExp('Close up to ' + MAX + ' tasks at a time'), label + ': ' + over.text);
    assert.equal(isDone(a), false, label + ': closed past the limit');
    // CONTROL: exactly the limit passes (the same number repeated is one close).
    const at = await run(['task', 'close', projectId, ...Array(MAX).fill(String(a))], token('mara'));
    assert.equal(at.code, 0, label + ': ' + at.text);
    assert.equal(isDone(a), true, label);
  }
});

test('#7412 review 5: a project that does not exist is said once, and the rest are not sent', async () => {
  for (const [label, run] of BOTH) {
    const r = await run(['task', 'close', 'no-such-project-7412', '1', '2', '3'], token('mara'));
    assert.equal(r.code, 1, label + ': ' + r.text);
    assert.equal((r.text.match(/Could not close task/g) || []).length, 1, label + ': one refusal line: ' + r.text);
    assert.match(r.text, /^\s*Could not close task 1: there is no project by that name\.$/m, label + ': one period, as the board said it: ' + r.text);
    assert.match(r.text, /^\s*Not tried: 2, 3\.$/m, label + ': ' + r.text);
  }
});

test('#7412 review 6: a redirect and a timeout read the same on both commands, and say only what is known', { timeout: 120000 }, async () => {
  const http = require('node:http');
  const same = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').replace(/[0-9]+/g, 'N');
  for (const mode of ['redirect', 'timeout']) {
    const texts = {};
    for (const [label] of BOTH) {
      const [a, b, c] = open(mode + ' ' + label);
      const held = [];
      const isB = (u) => new RegExp('/task/' + b + '/close$').test(u);
      // The Mac meets a real listener: a 302 for task b, or no answer at all (curl gives up after its 15 s, exit 28).
      const proxy = http.createServer((req, res) => {
        if (req.method === 'POST' && isB(req.url)) {
          if (mode === 'redirect') { res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' }); res.end(); } else held.push(res);
          return;
        }
        const up = http.request({ host: '127.0.0.1', port: server.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
        up.on('error', () => { res.statusCode = 502; res.end(); });
        req.pipe(up);
      });
      await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
      // Windows: the same 302 from the proxy; a timeout as fetch reports one (AbortSignal.timeout), without the 15 s wait.
      const winFetch = mode === 'timeout'
        ? (u, opts) => (isB(String(u)) ? Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })) : fetch(u, opts))
        : null;
      try {
        const r = await runVia(label, proxy.address().port, ['task', 'close', projectId, String(a), String(b), String(c)], token('mara'), winFetch);
        assert.equal(r.code, 1, label + ' ' + mode + ': ' + r.text);
        assert.match(r.text, new RegExp('^\\s*Closed task ' + a + ' on ', 'm'), label + ' ' + mode + ': ' + r.text);
        if (mode === 'redirect') {
          assert.match(r.text, new RegExp('tried to send the close of task ' + b + ' somewhere else'), label + ': ' + r.text);
          assert.doesNotMatch(r.text, /may have closed|check before doing it again/, label + ': a redirect did not reach Kosmos: ' + r.text);
          assert.match(r.text, new RegExp('^\\s*Not tried: ' + b + ', ' + c + '\\.$', 'm'), label + ': ' + r.text);
        } else {
          assert.match(r.text, new RegExp('^\\s*Task ' + b + ' may have closed anyway', 'm'), label + ': ' + r.text);
          assert.doesNotMatch(r.text, /too busy|Is it running/, label + ': ' + r.text);
          assert.match(r.text, new RegExp('^\\s*Not tried: ' + c + '\\.$', 'm'), label + ': ' + r.text);
        }
        assert.equal(isDone(b), false, label + ' ' + mode); assert.equal(isDone(c), false, label + ' ' + mode);
        texts[label] = same(r.text);
      } finally {
        for (const res of held) { try { res.socket.destroy(); } catch { /* gone */ } }
        proxy.close();
      }
    }
    assert.equal(texts.Windows, texts.Mac, mode + ': the two commands disagree');
  }
});

test('#7412 review 8: a board that cannot check (503) is said once and stops the run, on both commands; an unreadable answer is not said as refused', async () => {
  const http = require('node:http');
  for (const [label] of BOTH) for (const mode of ['503', 'unreadable']) {
    const [a, b, c] = open(mode + ' ' + label);
    const isB = (u) => new RegExp('/task/' + b + '/close$').test(u);
    const proxy = http.createServer((req, res) => {
      if (req.method === 'POST' && isB(req.url)) {
        if (mode === '503') { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"we could not check that agent just now, so the task was not closed"}'); }
        else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>not the board</html>'); }
        return;
      }
      const up = http.request({ host: '127.0.0.1', port: server.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.statusCode = 502; res.end(); });
      req.pipe(up);
    });
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    try {
      const r = await runVia(label, proxy.address().port, ['task', 'close', projectId, String(a), String(b), String(c)], token('mara'));
      assert.equal(r.code, 1, label + ' ' + mode + ': ' + r.text);
      assert.match(r.text, new RegExp('^\\s*Closed task' + (mode === '503' ? ' ' + a : 's ' + a + ', ' + c) + ' on ', 'm'), label + ' ' + mode + ': ' + r.text);
      if (mode === '503') {
        assert.match(r.text, new RegExp('^\\s*Could not close task ' + b + ': we could not check that agent just now', 'm'), label + ': ' + r.text);
        assert.match(r.text, new RegExp('^\\s*Not tried: ' + c + '\\.$', 'm'), label + ': the run stops at a 503: ' + r.text);
        assert.equal(isDone(c), false, label + ': sent after a 503');
      } else {
        assert.doesNotMatch(r.text, /Could not close/, label + ': an unreadable answer is not a refusal: ' + r.text);
        assert.match(r.text, new RegExp('^\\s*Task ' + b + ': Kosmos gave an answer we could not read; check kosmos task list ', 'm'), label + ': ' + r.text);
      }
    } finally {
      proxy.close();
    }
  }
});

'use strict';
/**
 * #570 7c-3: the road from the board to a Windows agent.
 *
 * 🛑 EVERY ARM RUNS ON ANY PLATFORM, which is this lane's standing rule and the
 * reason `serve`/`clientMain`/`say` all take the address as a parameter. Windows
 * has named pipes and the fleet's CI is a Mac; the code under test is the same on
 * both, so the address is the only thing that differs and it is injected. An arm
 * that only ran on Windows would be an arm nothing runs.
 *
 *   node --test engine/win32channel.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win32chan-570-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const channel = require('./win32channel');

let seq = 0;
/** A local address this platform can actually serve: a pipe on Windows, a socket
    everywhere else. The module never derives one in a test, so nothing here can
    collide with a real agent's channel on the developer's own box. */
function address() {
  seq += 1;
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\kosmos-test-' + process.pid + '-' + seq
    : path.join(SANDBOX, 'sock-' + seq);
}

const open = [];
function serving(name, opts) {
  const s = channel.serve(name, Object.assign({ pipe: address() }, opts));
  if (s.ok) open.push(s);
  return s;
}

test.after(() => {
  for (const s of open) { try { s.close(); } catch { /* already gone */ } }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** Drive the client half in-process and hand back what it decided. */
function ask(name, text, pipe, opts) {
  return new Promise((resolve) => {
    channel.clientMain(name, text, Object.assign({ pipe, onDone: resolve }, opts));
  });
}

test('#570 7c-3 a message crosses the channel and the ANSWER comes back', async () => {
  /* 🔑 THE WHOLE SLICE. After 7c-2 the supervisor could type at the agent and
     nothing outside that process could ask it to. This is the asking. It is a
     request and a REPLY rather than a drop, because chat.js reports one of three
     verdicts -- placed, could_not, unconfirmed -- and a channel that could only
     post into a void could not tell them apart. */
  const said = [];
  const s = serving('crosser', { onSay: (text, done) => { said.push(text); done({ ok: true }); } });
  assert.equal(s.ok, true, s.because || '');

  const r = await ask('crosser', 'ship it', s.pipe);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(said, ['ship it']);
});

test('#570 7c-3 a caller without the token is refused, and NOTHING is delivered', async () => {
  /* 🛑 THE REFUSAL HAS TO COME BEFORE THE WORK, not after it. An unauthenticated
     caller learns only that it was refused -- not whether the agent exists, not
     whether it is up, and above all it does not get to type at somebody's agent. */
  const said = [];
  const s = serving('guarded', { onSay: (t, done) => { said.push(t); done({ ok: true }); } });

  const net = require('node:net');
  const r = await new Promise((resolve) => {
    const sock = net.connect(s.pipe, () => {
      sock.write(JSON.stringify({ v: 1, token: 'not-the-secret', type: 'say', text: 'let me in' }) + '\n');
    });
    let buf = '';
    sock.on('data', (c) => {
      buf += c.toString('utf8');
      if (buf.includes('\n')) { resolve(JSON.parse(buf.split('\n')[0])); sock.destroy(); }
    });
    sock.on('error', () => resolve({ ok: false, because: 'connect failed' }));
  });

  assert.equal(r.ok, false);
  assert.match(r.because, /not a caller this agent answers/);
  assert.deepEqual(said, [], 'a refused caller must not reach the agent at all');
});

test('#570 7c-3 the secret is compared in CONSTANT TIME, and a length mismatch is not a throw', () => {
  /* `crypto.timingSafeEqual` throws on unequal lengths rather than answering
     false, so the length is checked first and separately. Length leaks either way;
     the bytes are the secret, and `===` on those would leak the prefix to anything
     that can time a reply. */
  assert.equal(channel.sameSecret('abc', 'abc'), true);
  assert.equal(channel.sameSecret('abc', 'abd'), false);
  assert.equal(channel.sameSecret('abc', 'abcd'), false, 'a length mismatch answers false');
  assert.equal(channel.sameSecret('', ''), true);
  assert.equal(channel.sameSecret(null, undefined), true, 'both empty is a degenerate match, not a crash');
});

test('#570 7c-3 the secret is minted ONCE and never rotated out from under a live channel', () => {
  /* ⚠️ EITHER SIDE MAY CREATE IT AND NEITHER MAY OVERWRITE IT. The supervisor
     reaches this when it starts serving and the board when it first sends; which
     is first depends on timing nobody controls. A plain write would let a send
     rotate the secret out from under a supervisor already serving, and the symptom
     would be an agent that stops answering for no reason a log could explain. */
  const a = channel.ensureSecret('minted');
  assert.equal(a.ok, true, a.because || '');
  assert.ok(a.secret.length >= 32);
  const b = channel.ensureSecret('minted');
  assert.equal(b.secret, a.secret, 'a second call reads what the first wrote');

  const at = channel.secretPath('minted');
  assert.equal(fs.readFileSync(at, 'utf8').trim(), a.secret);
  assert.notEqual(channel.ensureSecret('minted-other').secret, a.secret,
    'and it is per agent -- one agent\'s channel is not another\'s');
});

test('#570 7c-3 a supervisor that is not there says SO, and says it is not running', async () => {
  /* 🔑 WINDOWS GIVES US THIS ONE CLEANLY. A named pipe stops existing when its
     server exits, so "the supervisor is down" arrives as ENOENT on connect -- at
     once, with no timeout to wait out and no stale socket file to mistake for a
     live one. It is the failure this channel most needs to report well. */
  const r = await ask('nobody-home', 'anyone?', address(), { timeoutMs: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.down, true, 'the caller can word "down" differently from "refused"');
  assert.match(r.because, /not running just now/);
  assert.match(r.because, /did not type anything/, 're-sending has to be safe, so say nothing was typed');
});

/* ── #570 7c-4: which failures may have delivered ───────────────────────────── */

test('#570 7c-4 a reply that never comes is UNSURE, because the message was already handed over', async () => {
  /* The supervisor got the message and never said what happened. It may well be
     in the agent's conversation, so "not delivered" would invite a duplicate. */
  const said = [];
  const s = serving('mute', { onSay: (t) => { said.push(t); /* never answers */ } });
  const r = await ask('mute', 'hello', s.pipe, { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.unsure, true);
  assert.match(r.because, /cannot tell whether it arrived/);
  assert.deepEqual(said, ['hello'], 'and it really had been handed over');
});

test('#570 7c-4 a channel that drops after the request is UNSURE, however it drops', async () => {
  /* A server that hangs up on receipt: depending on timing the client sees a
     clean close or a reset error. Both come after the write, so both are unsure. */
  const net = require('node:net');
  const addr = address();
  const srv = net.createServer((sock) => { sock.on('error', () => {}); sock.on('data', () => sock.destroy()); });
  await new Promise((res) => srv.listen(addr, res));
  try {
    const r = await ask('slammer', 'hello', addr, { timeoutMs: 2000 });
    assert.equal(r.ok, false);
    assert.equal(r.unsure, true, r.because);
  } finally { srv.close(); }
});

test('#570 7c-4 down and refused are NOT unsure: nothing was typed, so re-sending is safe', async () => {
  const down = await ask('nobody-home-2', 'x', address(), { timeoutMs: 500 });
  assert.equal(down.down, true);
  assert.ok(!down.unsure);
  const s = serving('refuser', { onSay: (t, done) => done({ ok: false, because: 'it would not take it' }) });
  const refused = await ask('refuser', 'x', s.pipe);
  assert.equal(refused.ok, false);
  assert.ok(!refused.unsure);
});

test('#570 7c-4 a helper that never started is a definite no, not an unsure one', () => {
  /* The one say() failure that is provably before any write: the helper
     process could not even be spawned. */
  const r = channel.say('nohelper', 'x', { pipe: address(), node: path.join(SANDBOX, 'no-such-node.exe'), timeoutMs: 500 });
  assert.equal(r.ok, false);
  assert.ok(!r.unsure);
  assert.match(r.because, /could not reach it to type anything/);
});

test('#570 7c-4 the supervisor does NOT time out a message it has already handed over', async () => {
  /* Found in review: the server's idle timer kept running after onSay, and when
     it fired it answered "nothing arrived" -- a definite no -- for a message
     whose write to the agent was still queued. With the timer stopped at
     handover, the only way this ends is the caller's own timeout, which is
     unsure. idleMs is shorter than the caller's timeout so the old defect would
     answer first. */
  const s = serving('pending', { idleMs: 200, onSay: () => { /* still writing */ } });
  const r = await ask('pending', 'hello', s.pipe, { timeoutMs: 900 });
  assert.equal(r.ok, false);
  assert.equal(r.unsure, true, r.because);
  assert.doesNotMatch(r.because, /nothing arrived/);
});

test('#570 7c-4 a helper that dies without a verdict is unsure, and says it stopped', () => {
  const script = path.join(SANDBOX, 'helper-dies.js');
  fs.writeFileSync(script, 'process.exit(1);\n', 'utf8');
  const r = channel.say('dies', 'x', { pipe: address(), helper: script, timeoutMs: 2000 });
  assert.equal(r.ok, false);
  assert.equal(r.unsure, true);
  assert.match(r.because, /stopped before it told us/);
});

test('#570 7c-4 a helper killed at the deadline is unsure, and says it did not answer in time', () => {
  const script = path.join(SANDBOX, 'helper-hangs.js');
  fs.writeFileSync(script, 'setTimeout(() => {}, 60000);\n', 'utf8');
  const r = channel.say('hangs', 'x', { pipe: address(), helper: script, timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.unsure, true);
  assert.match(r.because, /did not answer us in time/);
});

test('#570 7c-4 a helper that RAN but left no readable verdict is unsure, not a definite no', () => {
  /* Found in review round 3: a helper that exited 0 with garbage or nothing on
     stdout read as could_not, yet it ran and may have handed the message over. */
  for (const [label, body] of [
    ['garbage', "process.stdout.write('not json\\n');\n"],
    ['silent', ''],
    ['array', "process.stdout.write('[]\\n');\n"],   // typeof [] is 'object'; round 4 found it slipping past
    ['empty-object', "process.stdout.write('{}\\n');\n"],   // an object with no verdict in it (round 5)
    ['ok-not-boolean', "process.stdout.write('{\"ok\":1}\\n');\n"],
  ]) {
    const script = path.join(SANDBOX, 'helper-' + label + '.js');
    fs.writeFileSync(script, body, 'utf8');
    const r = channel.say('garbled-' + label, 'x', { pipe: address(), helper: script, timeoutMs: 2000 });
    assert.equal(r.ok, false, label);
    assert.equal(r.unsure, true, label + ': it ran, so it may have delivered');
    assert.match(r.because, /cannot tell whether it arrived/, label);
  }
});

test('#570 7c-4 a reply we cannot read, after the request was written, is unsure', async () => {
  /* The supervisor had the request and may have typed it; only its answer is
     unreadable. Reading that as "not delivered" invites a second send. */
  const net = require('node:net');
  for (const reply of ['not json\n', 'null\n', '[]\n', '{}\n', '{"ok":1}\n', '{"because":"x"}\n']) {
    const at = address();
    const server = net.createServer((sock) => { sock.once('data', () => sock.end(reply)); });
    await new Promise((res) => server.listen(at, res));
    try {
      const r = await ask('unreadable', 'hello', at);
      assert.equal(r.ok, false, JSON.stringify(reply));
      assert.equal(r.unsure, true, JSON.stringify(reply) + ' came after the request was written');
      assert.match(r.because, /could not make sense/);
    } finally {
      await new Promise((res) => server.close(res));
    }
  }
});

test('#570 7c-4 an onSay that THROWS is unsure, the same reading chat.js gives a throwing say()', async () => {
  const s = serving('thrower', { onSay: () => { throw Object.assign(new Error('boom'), { code: 'EBOOM' }); } });
  const r = await ask('thrower', 'hello', s.pipe);
  assert.equal(r.ok, false);
  assert.equal(r.unsure, true);
  assert.match(r.because, /EBOOM.*cannot tell whether it arrived/);
});

test('#570 7c-3 a delivery the supervisor could not make is relayed with ITS sentence', async () => {
  /* The supervisor knows things the board cannot: that the agent died between the
     roster read and the write, that the pipe broke. Inventing a sentence here would
     bury the one that could be acted on. */
  const s = serving('honest', {
    onSay: (t, done) => done({ ok: false, because: 'it is not running just now, so we did not type anything' }),
  });
  const r = await ask('honest', 'hello', s.pipe);
  assert.equal(r.ok, false);
  assert.match(r.because, /not running just now/);
  assert.ok(!r.unsure, 'nothing was typed, so the board may say not delivered');
});

test('#570 7c-4 the supervisor\'s UNSURE survives the crossing', async () => {
  /* Only the supervisor knows its write had started before it failed. A server
     that relayed the sentence but dropped the flag would turn a maybe-delivered
     message into "not delivered" at the board -- the duplicate-send hazard. */
  const s = serving('halfway', {
    onSay: (t, done) => done({ ok: false, unsure: true, because: 'the write to it failed part-way (EPIPE), so we cannot tell whether it arrived' }),
  });
  const r = await ask('halfway', 'hello', s.pipe);
  assert.equal(r.ok, false);
  assert.equal(r.unsure, true);
  assert.match(r.because, /failed part-way/);
});

test('#570 headless: a pipe the PREVIOUS supervisor still holds is retried until it frees', async () => {
  /* A restart's /Run lands while the old supervisor is still leaving and still
     holds the pipe. The listen fails with EADDRINUSE as an async event; this used
     to be swallowed, leaving the new supervisor with no channel for its whole life. */
  const net = require('node:net');
  const at = address();
  const occupier = net.createServer(() => {});
  await new Promise((res) => occupier.listen(at, res));
  const problems = [];
  const s = serving('retrier', { pipe: at, onSay: (t, done) => done({ ok: true }), onProblem: (w) => problems.push(w) });
  assert.equal(s.ok, true);
  await new Promise((res) => setTimeout(res, 400));
  await new Promise((res) => occupier.close(res));   // the old supervisor finally leaves
  await new Promise((res) => setTimeout(res, 800));
  const r = await ask('retrier', 'hello', at);
  assert.deepEqual(r, { ok: true }, 'the new supervisor took the pipe once it was free');
  assert.deepEqual(problems, [], 'a busy pipe is retried, not reported');
});

test('#570 headless: close() cancels a pending retry, so a stopped supervisor never takes the pipe later', async () => {
  const net = require('node:net');
  const at = address();
  const occupier = net.createServer(() => {});
  await new Promise((res) => occupier.listen(at, res));
  const s = serving('closer', { pipe: at, onSay: (t, done) => done({ ok: true }), retryMs: 100 });
  await new Promise((res) => setTimeout(res, 150));   // at least one retry is pending
  s.close();                                          // the supervisor stops
  await new Promise((res) => occupier.close(res));    // then the pipe frees
  await new Promise((res) => setTimeout(res, 400));   // several retry periods later
  const r = await ask('closer', 'hello', at);
  assert.equal(r.ok, false, 'nothing is listening: the retry was cancelled');
  assert.equal(r.down, true);
});

test('#570 headless: a pipe that never frees is given up on, and SAID', async () => {
  const net = require('node:net');
  const at = address();
  const occupier = net.createServer(() => {});
  await new Promise((res) => occupier.listen(at, res));
  const problems = [];
  const s = serving('stuck', { pipe: at, onSay: (t, done) => done({ ok: true }), retryMs: 30, retryLimit: 2, onProblem: (w) => problems.push(w) });
  try {
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(problems.length, 1, 'exactly one report, after the retries ran out');
    assert.match(problems[0], /could not open its channel \(EADDRINUSE\)/);
  } finally {
    s.close();
    await new Promise((res) => occupier.close(res));
  }
});

test('#570 7c-3 more than a message is refused rather than buffered', async () => {
  /* An unauthenticated connection must not be able to grow the supervisor's heap.
     chat.js caps a person's text at 2000 characters, so anything near this bound is
     not a message somebody typed. */
  const said = [];
  const s = serving('bounded', { onSay: (t, done) => { said.push(t); done({ ok: true }); } });

  const net = require('node:net');
  const r = await new Promise((resolve) => {
    const sock = net.connect(s.pipe, () => { sock.write('x'.repeat(channel.MAX_REQUEST_BYTES + 1024)); });
    let buf = '';
    sock.on('data', (c) => {
      buf += c.toString('utf8');
      if (buf.includes('\n')) { resolve(JSON.parse(buf.split('\n')[0])); sock.destroy(); }
    });
    sock.on('error', () => resolve({ ok: false, because: 'connect failed' }));
  });
  assert.equal(r.ok, false);
  assert.match(r.because, /more than a message/);
  assert.deepEqual(said, []);
});

test('#570 7c-4 more bytes after a message is handed over are ignored, never typed a second time', async () => {
  /* Found in review, reproduced against the real serve(): with a slow write
     pending, a second chunk on the same connection re-parsed the first line and
     handed the SAME message to onSay again -- two writes into the agent for one
     send, the duplicate this whole channel exists to prevent. */
  const said = [];
  const s = serving('once', {
    secret: 'test-secret-once',
    onSay: (t, done) => { said.push(t); setTimeout(() => done({ ok: true }), 300); },
  });
  const net = require('node:net');
  const r = await new Promise((resolve) => {
    const sock = net.connect(s.pipe, () => {
      sock.write(JSON.stringify({ v: 1, token: 'test-secret-once', type: 'say', text: 'hello' }) + '\n');
      setTimeout(() => { sock.write('one more line\n'); }, 50);
    });
    let buf = '';
    sock.on('data', (c) => { buf += c.toString('utf8'); if (buf.includes('\n')) { resolve(JSON.parse(buf.split('\n')[0])); sock.destroy(); } });
    sock.on('error', () => resolve({ ok: false, because: 'connect failed' }));
  });
  assert.deepEqual(r, { ok: true }, 'the answer is still the one onSay gave');
  assert.deepEqual(said, ['hello'], 'handed over exactly once');
});

test('#570 7c-3 nonsense on the wire is refused with a sentence, never a crash', async () => {
  const s = serving('nonsense', { onSay: (t, done) => done({ ok: true }) });
  const net = require('node:net');
  const r = await new Promise((resolve) => {
    const sock = net.connect(s.pipe, () => { sock.write('this is not json\n'); });
    let buf = '';
    sock.on('data', (c) => { buf += c.toString('utf8'); if (buf.includes('\n')) { resolve(JSON.parse(buf.split('\n')[0])); sock.destroy(); } });
    sock.on('error', () => resolve({ ok: false, because: 'connect failed' }));
  });
  assert.equal(r.ok, false);
  assert.match(r.because, /could not make sense/);
});

/**
 * 🛑 `say()` CANNOT BE TESTED AGAINST A SERVER IN THIS PROCESS, and finding that
 * out is worth writing down. It blocks on `execFileSync` -- which stops this
 * thread's event loop -- so an in-process server never gets to accept the
 * connection and the call times out against itself. That is not a defect in the
 * channel; it is the production topology asserting itself. The supervisor is
 * always a DIFFERENT process, so the fixture has to be one too.
 */
function servingElsewhere(name, addr) {
  const script = path.join(SANDBOX, 'serve-' + name + '.js');
  const heard = path.join(SANDBOX, 'heard-' + name + '.txt');
  const ready = path.join(SANDBOX, 'ready-' + name + '.txt');
  fs.writeFileSync(script, [
    "'use strict';",
    'process.env.AGENT_WORKFORCE_DATA = ' + JSON.stringify(process.env.AGENT_WORKFORCE_DATA) + ';',
    "const fs = require('node:fs');",
    'const channel = require(' + JSON.stringify(path.join(__dirname, 'win32channel.js')) + ');',
    'const s = channel.serve(' + JSON.stringify(name) + ', {',
    '  pipe: ' + JSON.stringify(addr) + ',',
    '  onSay: (text, done) => { fs.appendFileSync(' + JSON.stringify(heard) + ', JSON.stringify(text) + "\\n"); done({ ok: true }); },',
    '});',
    'if (!s.ok) { process.stderr.write(s.because + "\\n"); process.exit(1); }',
    'fs.writeFileSync(' + JSON.stringify(ready) + ', "up");',
  ].join('\n'), 'utf8');

  const child = require('node:child_process').spawn(process.execPath, [script], { stdio: ['ignore', 'ignore', 'pipe'] });
  return { child, heard, ready };
}

async function waitFor(file, ms) {
  const until = Date.now() + ms;
  for (;;) {
    if (fs.existsSync(file)) return true;
    if (Date.now() > until) return false;
    await new Promise((res) => setTimeout(res, 25));
  }
}

test('#570 7c-3 THE SYNCHRONOUS CLIENT: say() blocks, bounded, and answers inline', async () => {
  /* 🛑 WHY IT IS OUT OF PROCESS AT ALL. `chat.js`'s `deliver()` is straight-line
     synchronous code -- it blocks on tmux through execFileSync and reads the answer
     inline -- so the win32 arm has to answer the same way. There is no synchronous
     named-pipe read in Node that can be given a deadline, and one without a
     deadline is the board's HTTP thread held by a supervisor nobody can see. So the
     blocking happens in a CHILD, under execFileSync's timeout, exactly as the Mac
     path already blocks on tmux. */
  const addr = address();
  const srv = servingElsewhere('syncer', addr);
  assert.equal(await waitFor(srv.ready, 8000), true, 'the stand-in supervisor came up');

  const r = channel.say('syncer', 'from the board', { pipe: addr, timeoutMs: 6000 });
  assert.deepEqual(r, { ok: true });
  assert.equal(fs.readFileSync(srv.heard, 'utf8').trim(), JSON.stringify('from the board'),
    'the message really crossed, in one blocking call');
  srv.child.kill();
});

test('#570 7c-3 say() reports a down supervisor rather than a failed helper', () => {
  /* ⚠️ THE HELPER EXITS NON-ZERO ON EVERY REFUSAL, so a caller that read the exit
     code first would turn every honest sentence into "the helper failed". stdout is
     read first for exactly that reason. */
  const r = channel.say('still-nobody-home', 'hello', { pipe: address(), timeoutMs: 1500 });
  assert.equal(r.ok, false);
  assert.equal(r.down, true);
  assert.match(r.because, /not running just now/);
});

test('#570 7c-3 a message with newlines and quotes survives the crossing intact', async () => {
  /* The wire is one JSON line each way, so the text is escaped rather than
     delimited by anything a person could type. The Mac path had to learn this the
     hard way about tmux's `;` and about newlines inside `send-keys -l`. Driven
     through the WHOLE path -- helper process, stdin, socket, back -- because that
     is where an encoding gets lost. */
  const addr = address();
  const srv = servingElsewhere('exact', addr);
  assert.equal(await waitFor(srv.ready, 8000), true);

  const tricky = 'line one\nline "two"\ttabbed; and a \\ backslash';
  const r = channel.say('exact', tricky, { pipe: addr, timeoutMs: 6000 });
  assert.deepEqual(r, { ok: true });
  assert.equal(JSON.parse(fs.readFileSync(srv.heard, 'utf8').trim()), tricky,
    'byte for byte, or somebody\'s message arrives changed');
  srv.child.kill();
});

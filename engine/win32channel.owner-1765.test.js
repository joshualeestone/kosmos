'use strict';
/**
 * #1765: the board's side of the agent channel checks who holds the pipe before it writes anything
 * (engine/win32channel.js serverOwnerOf, ownerRefusal, and the check in clientMain).
 *
 * The rule and the client's handling run on every platform, against a unix socket, with the owner
 * answer handed in through the `checkServer` seam. On Windows only, the real check is asked about real
 * named pipes this account creates: it answers this account, the message goes through with no seam at
 * all, and the time it adds is measured. A pipe owned by ANOTHER account cannot be made on the Windows
 * box this was written on (that takes a second account's password or an administrator's privilege to
 * set an owner), so the refusal of one is proved through the seam, with the bytes on the wire checked.
 *
 *   node --test engine/win32channel.owner-1765.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win32chan-owner-1765-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const channel = require('./win32channel');

const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'asks Windows about a real named pipe' };
const ME = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const SOMEONE_ELSE = 'S-1-5-21-1111111111-2222222222-3333333333-1002';

let seq = 0;
function address() {
  seq += 1;
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\kosmos-test-owner-' + process.pid + '-' + seq
    : path.join(SANDBOX, 'sock-' + seq);
}

const open = [];
test.after(() => {
  for (const s of open) { try { s.close(); } catch { /* already gone */ } }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

function ask(name, text, pipe, opts) {
  return new Promise((resolve) => {
    channel.clientMain(name, text, Object.assign({ pipe, onDone: resolve }, opts));
  });
}

/** A listener that records every byte it is sent and answers nothing: what a squatter would see. */
async function recorder() {
  const addr = address();
  const got = [];
  const srv = net.createServer((sock) => { sock.on('error', () => {}); sock.on('data', (c) => got.push(c.toString('utf8'))); });
  await new Promise((res) => srv.listen(addr, res));
  open.push(srv);
  return { addr, got, srv };
}

/* ---- the rule ---------------------------------------------------------------- */

test('#1765: only this account, Administrators and SYSTEM may hold the pipe', () => {
  assert.equal(channel.ownerRefusal({ owner: ME, me: ME }), null);
  assert.equal(channel.ownerRefusal({ owner: 'S-1-5-32-544', me: ME }), null, 'Administrators (a full admin token\'s owner)');
  assert.equal(channel.ownerRefusal({ owner: 'S-1-5-18', me: ME }), null, 'SYSTEM');
  assert.deepEqual(channel.TRUSTED_PIPE_OWNERS, ['S-1-5-32-544', 'S-1-5-18']);
  for (const owner of [SOMEONE_ELSE, 'S-1-5-32-545', 'S-1-1-0', 'S-1-5-11', 'S-1-3-0']) {
    assert.match(channel.ownerRefusal({ owner, me: ME }), /held by another account on this computer, so we did not type anything/, owner);
  }
});

test('#1765: an answer that is not two SIDs is a refusal, never a pass', () => {
  for (const a of [null, {}, { owner: ME }, { me: ME }, { owner: '', me: '' }, { owner: 'joshu', me: 'joshu' },
    { owner: ME + ' ', me: ME }, { owner: ME, me: ME + '\n' }, { owner: 'S-1-', me: 'S-1-' }, { owner: 7, me: 7 }]) {
    assert.match(channel.ownerRefusal(a), /could not confirm its channel belongs to you, so we did not type anything/, JSON.stringify(a));
  }
});

/* ---- the client: nothing is written until the owner is known ----------------- */

test('#1765: a pipe held by another account gets NOTHING: no token, no words', async () => {
  const sq = await recorder();
  const r = await ask('squatted', 'the secret plan', sq.addr, { timeoutMs: 1000, checkServer: async () => ({ owner: SOMEONE_ELSE, me: ME }) });
  assert.equal(r.ok, false);
  assert.match(r.because, /held by another account/);
  assert.ok(!r.unsure, 'nothing was written, so it is a definite no');
  assert.ok(!r.down);
  await new Promise((res) => setTimeout(res, 100));
  assert.deepEqual(sq.got, [], 'bytes reached the other account\'s pipe');
});

test('#1765: a check that fails or throws refuses, and writes nothing', async () => {
  for (const [label, check] of [
    ['rejects', async () => { throw new Error('Windows did not say in time'); }],
    ['throws', () => { throw new Error('boom'); }],
    ['answers nonsense', async () => ({ owner: 'nobody' })],
    ['answers nothing', async () => undefined],
  ]) {
    const sq = await recorder();
    const r = await ask('unchecked-' + label.replace(/\s/g, '-'), 'hello', sq.addr, { timeoutMs: 1000, checkServer: check });
    assert.equal(r.ok, false, label);
    assert.match(r.because, /could not confirm its channel belongs to you/, label);
    assert.match(r.because, /did not type anything/, label);
    assert.ok(!r.unsure, label);
    await new Promise((res) => setTimeout(res, 50));
    assert.deepEqual(sq.got, [], label + ': bytes were written');
  }
});

test('#1765: the check is asked about the very address the client connected to, after it connected', async () => {
  const said = [];
  const addr = address();
  const s = channel.serve('asked', { pipe: addr, onSay: (t, done) => { said.push(t); done({ ok: true }); } });
  assert.equal(s.ok, true, s.because || '');
  open.push(s);
  const seen = [];
  const r = await ask('asked', 'hi', addr, { checkServer: (at) => { seen.push(at); return { owner: ME, me: ME }; } });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(seen, [addr]);
  assert.deepEqual(said, ['hi']);
});

test('#1765: a slow check does not eat the conversation\'s own time', async () => {
  const said = [];
  const addr = address();
  const s = channel.serve('slowcheck', { pipe: addr, onSay: (t, done) => { said.push(t); setTimeout(() => done({ ok: true }), 150); } });
  open.push(s);
  const r = await ask('slowcheck', 'hi', addr, { timeoutMs: 300, checkServer: () => new Promise((res) => setTimeout(() => res({ owner: ME, me: ME }), 500)) });
  assert.deepEqual(r, { ok: true }, 'the check\'s 500 ms counted against a 300 ms conversation');
  assert.deepEqual(said, ['hi']);
});

test('#1765: on Windows the real check is the default; elsewhere there is no named pipe to ask about', () => {
  const src = fs.readFileSync(path.join(__dirname, 'win32channel.js'), 'utf8');
  assert.match(src, /const checkServer = o\.checkServer !== undefined \? o\.checkServer\n\s*: \(process\.platform === 'win32' \? \(where\) => serverOwnerOf\(where, OWNER_CHECK_TIMEOUT_MS\) : null\);/);
  // say() gives the helper the check's bound on top of the conversation's on Windows.
  assert.match(src, /timeout: timeout \+ 2000 \+ \(process\.platform === 'win32' \? OWNER_CHECK_TIMEOUT_MS : 0\),/);
  // The write happens only in send(), and send() only after the check, or with no check at all.
  assert.equal((src.match(/sock\.write\(/g) || []).length, 1, 'another write to the pipe appeared');
});

test('#1765: serverOwnerOf refuses anything that is not a named pipe, without asking Windows', async () => {
  await assert.rejects(channel.serverOwnerOf('/tmp/sock', 1000), /not a pipe Windows can say the owner of/);
  await assert.rejects(channel.serverOwnerOf('\\\\.\\pipe\\', 1000), /not a pipe Windows can say the owner of/);
  await assert.rejects(channel.serverOwnerOf('', 1000), /not a pipe Windows can say the owner of/);
});

/* ---- Windows: real pipes this account made --------------------------------------- */

function mySid() {
  const r = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const m = String(r.stdout).match(/"(S-1-[0-9-]+)"/);
  assert.ok(m, 'whoami did not name this account: ' + r.stdout);
  return m[1];
}

test('#1765: Windows names this account as the owner of a pipe this account made', WINDOWS_ONLY, async (t) => {
  const sid = mySid();
  const addr = address();
  const s = channel.serve('realowner', { pipe: addr, onSay: (t, done) => done({ ok: true }) });
  open.push(s);
  const t0 = Date.now();
  const a = await channel.serverOwnerOf(addr, channel.OWNER_CHECK_TIMEOUT_MS);
  const ms = Date.now() - t0;
  assert.deepEqual(a, { owner: sid, me: sid });
  assert.equal(channel.ownerRefusal(a), null);
  assert.ok(ms < channel.OWNER_CHECK_TIMEOUT_MS, 'the check took ' + ms + ' ms');
  t.diagnostic('serverOwnerOf took ' + ms + ' ms');
});

test('#1765: Windows has no owner to give for a pipe that is not there', WINDOWS_ONLY, async () => {
  await assert.rejects(channel.serverOwnerOf(address(), 2000), (e) => e instanceof Error && e.message.length > 0);
});

test('#1765: a second server cannot take a pipe name somebody already holds (what the check relies on)', WINDOWS_ONLY, async () => {
  const addr = address();
  const first = net.createServer(() => {});
  await new Promise((res) => first.listen(addr, res));
  open.push(first);
  const second = net.createServer(() => {});
  const err = await new Promise((res) => { second.on('error', res); second.listen(addr, () => res(null)); });
  try { second.close(); } catch { /* never listened */ }
  assert.ok(err && err.code === 'EADDRINUSE', 'a second server joined a held pipe name: ' + (err && err.code));
});

test('#1765: with no seam, a real pipe of this account takes the message', WINDOWS_ONLY, async () => {
  const said = [];
  const addr = address();
  const s = channel.serve('realcross', { pipe: addr, onSay: (t, done) => { said.push(t); done({ ok: true }); } });
  open.push(s);
  assert.deepEqual(await ask('realcross', 'in process', addr), { ok: true });
  assert.deepEqual(said, ['in process']);
});

/** A stand-in supervisor in another process, as engine/win32channel.test.js does it, so say() can block. */
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
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  return { child, heard, ready, stderr: () => stderr };
}

async function waitFor(file, ms) {
  const until = Date.now() + ms;
  while (!fs.existsSync(file)) {
    if (Date.now() > until) return false;
    await new Promise((res) => setTimeout(res, 25));
  }
  return true;
}

test('#1765: say(), the board\'s blocking call, checks the owner in its helper and delivers; the time is measured', WINDOWS_ONLY, async (t) => {
  const addr = address();
  const srv = servingElsewhere('saycheck', addr);
  try {
    assert.equal(await waitFor(srv.ready, 8000), true, 'the stand-in supervisor did not come up: ' + srv.stderr());
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      assert.deepEqual(channel.say('saycheck', 'message ' + i, { pipe: addr, timeoutMs: 6000 }), { ok: true });
      times.push(Date.now() - t0);
    }
    assert.deepEqual(fs.readFileSync(srv.heard, 'utf8').trim().split('\n'), ['"message 0"', '"message 1"', '"message 2"']);
    t.diagnostic('say() with the owner check took ' + times.join(', ') + ' ms');
  } finally { srv.child.kill(); }
});

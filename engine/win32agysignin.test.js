'use strict';
/**
 * #3568 / #3998 on Windows: the Gemini-subscription sign-in with only Google's page and a Kosmos code
 * box (engine/win32agysignin.js). A stand-in agy (test-support/fake-agy.js) runs as a real child and
 * prints agy 1.2.11's measured sign-in text; the typer seam writes the code to its stdin (real agy
 * reads its console; the real typer is exercised by the win32-only test at the end, against a child
 * that reads CONIN$ the way agy does).
 *
 *   node -r <no-schtasks-preload> --test engine/win32agysignin.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const agy = require('./win32agy');
const signin = require('./win32agysignin');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agysignin-')));
const FAKE = path.join(__dirname, '..', 'test-support', 'fake-agy.js');
agy.setRootForTests(path.join(SANDBOX, 'data'));
test.afterEach(() => { signin.resetForTests(); agy.setTreeKill(null); });
test.after(() => { agy.setRootForTests(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function rig(mode, opts) {
  const o = opts || {};
  const spawned = []; const opened = []; const typed = [];
  signin.setSpawn((file, args, sp) => {
    const c = spawn(process.execPath, [FAKE, ...args], Object.assign({}, sp, { env: Object.assign({}, sp.env, { FAKE_AGY_MODE: mode, FAKE_AGY_WAIT_MS: String(o.waitMs || 20000) }) }));
    spawned.push({ file, args, sp, child: c });
    return c;
  });
  signin.setOpener((link) => opened.push(link));
  signin.setTyper((pid, code) => { typed.push({ pid, code }); const s = spawned[spawned.length - 1]; s.child.stdin.write(code + '\n'); return { ok: true }; });
  agy.setTreeKill((c) => { try { process.kill(c.pid); } catch { /* gone */ } });
  const answers = (o.checks || [false, true]).slice();
  const checks = [];
  const check = (bin, dir) => { checks.push(dir); return Promise.resolve({ signedIn: answers.length > 1 ? answers.shift() : answers[0] }); };
  return { spawned, opened, typed, checks, start: () => signin.start({ bin: 'C:\\K\\agy.exe', check, capMs: o.capMs }) };
}
async function until(pred, ms) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return false;
}

test('already signed in (one sign-in per Windows user): done at once, no agy run, no page', async () => {
  const r = rig('signin', { checks: [true] });
  const s = r.start();
  assert.equal(s.ok, true);
  assert.ok(await until(() => signin.status().state === 'signed-in'));
  assert.equal(r.spawned.length, 0, 'no print run, no prompt spent');
  assert.equal(r.opened.length, 0, 'no page');
});

test('signed out: Kosmos opens Google\'s page ONCE, shows the box, hands agy the code, and ends signed in', async () => {
  const r = rig('signin');
  const s = r.start();
  assert.ok(await until(() => signin.status().state === 'waiting'), JSON.stringify(signin.status()));
  const st = signin.status();
  assert.equal(st.id, s.id);
  assert.match(st.link, /^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?/);
  assert.ok(st.secondsLeft > 0 && st.secondsLeft <= 60);
  assert.deepEqual(r.opened, [st.link], 'Kosmos itself opened exactly that page, once');
  const sp = r.spawned[0];
  assert.deepEqual(sp.args, ['--gemini_dir=' + agy.signinHome().geminiDir, '--print=' + signin.PROMPT, '--output-format', 'json']);
  assert.equal(sp.sp.cwd, agy.signinHome().workspace, 'a Kosmos-owned folder, never the home folder');
  assert.notEqual(path.resolve(sp.sp.cwd), path.resolve(os.homedir()));
  assert.equal(sp.sp.windowsHide, true);
  const pathKey = Object.keys(sp.sp.env).find((k) => k.toUpperCase() === 'PATH');
  assert.equal(sp.sp.env[pathKey].split(path.win32.delimiter)[0], agy.stubDir(), 'agy\'s own browser opener is the stub');

  assert.deepEqual(await signin.code('not a code!', s.id), { ok: false, because: signin.status().because || 'that does not look like the code from Google\'s page. Copy it with the page\'s Copy button and paste it here' });
  assert.equal(signin.status().state, 'waiting', 'a malformed paste changes nothing');
  assert.equal((await signin.code('good-code-0123', 'someone-else')).because, signin.NOT_MINE);
  assert.equal(r.typed.length, 0);
});

test('the pasted code reaches agy, which signs in; `agy models` must agree before Kosmos says signed in', async () => {
  const r = rig('signin', { checks: [false, true] });
  const s = r.start();
  assert.ok(await until(() => signin.status().state === 'waiting'));
  // "good..." is the stand-in's accepted code; a callback URL pasted whole has its code taken out.
  const res = await signin.code('https://antigravity.google/oauth-callback?code=good-4/0AXl_x&scope=x', s.id);
  assert.equal(res.ok, true);
  assert.deepEqual(r.typed.map((t) => t.code), ['good-4/0AXl_x']);
  assert.equal(r.typed[0].pid, r.spawned[0].child.pid);
  assert.ok(await until(() => signin.status().state === 'signed-in'), JSON.stringify(signin.status()));
  assert.equal(r.checks.length, 2, 'asked before, and again after');
});

test('Google refuses the code: it ends in words the person can act on', async () => {
  const r = rig('signin');
  const s = r.start();
  assert.ok(await until(() => signin.status().state === 'waiting'));
  await signin.code('4/0AXl-wrong_code', s.id);
  assert.ok(await until(() => signin.status().state === 'failed'));
  assert.match(signin.status().because, /Google did not accept that code.*fresh page/);
  assert.equal(r.opened.length, 1);
});

test('agy\'s one minute runs out: it says so and offers a fresh start', async () => {
  const r = rig('signin', { waitMs: 300 });
  r.start();
  assert.ok(await until(() => signin.status().state === 'failed'));
  assert.match(signin.status().because, /minute ran out/);
});

test('a link that is not Google\'s sign-in for agy is never opened', async () => {
  const r = rig('badlink');
  r.start();
  assert.ok(await until(() => signin.status().state === 'failed'));
  assert.match(signin.status().because, /does not recognise/);
  assert.equal(r.opened.length, 0);
});

test('Stop ends it (whole tree) only for the id it names; a new start replaces the old one', async () => {
  const r = rig('signin', { checks: [false] });   // signed out for both starts
  const a = r.start();
  assert.ok(await until(() => signin.status().state === 'waiting'));
  assert.equal(signin.stop('nope').because, signin.NOT_MINE);
  const b = r.start();
  assert.notEqual(b.id, a.id);
  assert.equal((await signin.code('good', a.id)).because, signin.NOT_MINE, 'the replaced sign-in takes no code');
  assert.ok(await until(() => signin.status().state === 'waiting'));
  assert.deepEqual(signin.stop(b.id), { ok: true });
  assert.equal(signin.status().state, 'failed');
  assert.ok(await until(() => r.spawned.every((x) => x.child.exitCode !== null || x.child.signalCode !== null)), 'no agy left running');
});

test('linkToOpen and cleanCode: only Google\'s page for agy\'s callback; only a code-shaped paste', () => {
  const good = 'https://accounts.google.com/o/oauth2/auth?client_id=x&code_challenge=a&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&state=s';
  assert.equal(signin.linkToOpen(good), good);
  assert.equal(signin.linkToOpen(good.replace('https:', 'http:')), null);
  assert.equal(signin.linkToOpen(good.replace('accounts.google.com', 'accounts.google.com.evil.io')), null);
  assert.equal(signin.linkToOpen(good.replace('antigravity.google', 'evil.io')), null);
  assert.equal(signin.linkToOpen(good + ',x'), null, 'a comma would split rundll32\'s command line');
  assert.equal(signin.cleanCode('  4/0AXl-abc_DEF.123  '), '4/0AXl-abc_DEF.123');
  assert.equal(signin.cleanCode('https://antigravity.google/oauth-callback?code=4/0AXlabcdefgh&scope=y'), '4/0AXlabcdefgh');
  assert.equal(signin.cleanCode('short'), null);
  assert.equal(signin.cleanCode('4/0AXl abc"; rm -rf'), null);
});

test('the typer script: the pid is a number in it, the code is NOT (it arrives on stdin)', () => {
  const s = signin.typerScript(4242);
  assert.match(s, /\[uint32\]4242,/);
  assert.match(s, /\[Console\]::In\.ReadLine\(\)/);
  assert.match(s, /AttachConsole/);
  assert.match(s, /CONIN\$/);
  assert.equal(signin.typerScript('4242; evil').includes('evil'), false, 'a non-number pid cannot inject');
});

test('win32: the real typer types into a child that reads its CONSOLE, spawned the way the sign-in spawns agy', { skip: process.platform !== 'win32' }, async () => {
  const reader = path.join(SANDBOX, 'conin-reader.js');
  fs.writeFileSync(reader, [
    "const fs = require('fs');",
    "const fd = fs.openSync('\\\\\\\\.\\\\CONIN$', 'r'); const b = Buffer.alloc(512); let got = '';",
    "while (!/\\r|\\n/.test(got)) { let n = 0; try { n = fs.readSync(fd, b, 0, b.length, null); } catch (e) { if (e.code === 'EAGAIN') continue; throw e; } if (n <= 0) break; got += b.slice(0, n).toString(); }",
    "process.stdout.write(got.replace(/[\\r\\n]+$/, ''));",
  ].join('\n'));
  const c = spawn(process.execPath, [reader], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', (d) => { out += d; });
  const closed = new Promise((res) => c.on('close', res));
  await new Promise((res) => setTimeout(res, 700));
  const r = await signin.typeIntoConsole(c.pid, '4/0AXl-test_code.123');
  const timer = setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, 15000);
  await closed; clearTimeout(timer);
  assert.deepEqual(r, { ok: true });
  assert.equal(out, '4/0AXl-test_code.123');
});

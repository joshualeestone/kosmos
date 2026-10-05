'use strict';
/* test-support/tmpscope.js (kosmos#4273): one require contains a test process's
   temp dirs, including its children's, and removes them at exit and on a signal.
   Each case runs a REAL child node process against a fresh base directory, with a
   control that does not require the scope and must leave its directory behind. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const SCOPE = path.join(__dirname, 'test-support', 'tmpscope.js');

function freshBase(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tsc-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}
const entries = (d) => fs.readdirSync(d);

const MAKE = `const fs=require('fs'),os=require('os'),path=require('path');
fs.mkdtempSync(path.join(os.tmpdir(),'fixture-'));`;

test('a raw mkdtemp is removed when the process exits; without the scope it stays (control)', (t) => {
  const base = freshBase(t);
  const scoped = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCOPE)});${MAKE}`], { env: { ...process.env, TMPDIR: base } });
  assert.equal(scoped.status, 0, String(scoped.stderr));
  assert.deepEqual(entries(base), [], 'the scoped process left something behind');
  const bare = spawnSync(process.execPath, ['-e', MAKE], { env: { ...process.env, TMPDIR: base } });
  assert.equal(bare.status, 0, String(bare.stderr));
  assert.equal(entries(base).filter((n) => n.startsWith('fixture-')).length, 1, 'the control did not leak, so this test cannot see a leak');
});

test("a child process's mkdtemp is contained too (it inherits the scoped TMPDIR)", (t) => {
  const base = freshBase(t);
  const child = `require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(MAKE)}]);`;
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCOPE)});${child}`], { env: { ...process.env, TMPDIR: base } });
  assert.equal(r.status, 0, String(r.stderr));
  assert.deepEqual(entries(base), [], 'the grandchild left something behind');
});

for (const SIG of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
test(`${SIG} removes the scope and the process still dies by ${SIG}`, { timeout: 15000 }, async (t) => {
  const base = freshBase(t);
  const code = `require(${JSON.stringify(SCOPE)});${MAKE}console.log('ready');setInterval(()=>{},1000);`;
  const c = spawn(process.execPath, ['-e', code], { env: { ...process.env, TMPDIR: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  /* A failed assertion must not leave the child running (it would hold the file open). */
  t.after(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((res, rej) => {
    c.stdout.on('data', (b) => { if (String(b).includes('ready')) res(); });
    c.on('exit', () => rej(new Error('the child exited before it was ready')));
  });
  assert.equal(entries(base).length, 1, 'the scope dir should exist while the process runs');
  const ended = new Promise((res) => c.on('exit', (code2, sig) => res({ code: code2, sig })));
  c.kill(SIG);
  const { sig } = await ended;
  assert.equal(sig, SIG, 'the process should still end by the signal it was sent');
  assert.deepEqual(entries(base), [], `a ${SIG} left the scope dir behind`);
});
}

test('the scope name is short, so a tmux socket path under it still fits', () => {
  // `kts-` plus six characters: under ten added, as run-tests.sh budgets for.
  assert.match(fs.readFileSync(SCOPE, 'utf8'), /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'kts-'\)\)/);
});

test("a file's own SIGTERM handler decides: the scope stays until that handler lets the process end", { timeout: 15000 }, async (t) => {
  const base = freshBase(t);
  // The file's own handler does async work that needs TMPDIR, then exits 3.
  const code = `require(${JSON.stringify(SCOPE)});
    process.on('SIGTERM', () => setTimeout(() => {
      try { require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'late-')); process.exit(3); }
      catch { process.exit(9); }
    }, 50));
    console.log('ready'); setInterval(() => {}, 1000);`;
  const c = spawn(process.execPath, ['-e', code], { env: { ...process.env, TMPDIR: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((res, rej) => {
    c.stdout.on('data', (b) => { if (String(b).includes('ready')) res(); });
    c.on('exit', () => rej(new Error('the child exited before it was ready')));
  });
  const ended = new Promise((res) => c.on('exit', (code2) => res(code2)));
  c.kill('SIGTERM');
  assert.equal(await ended, 3, 'the handler could not use TMPDIR (9) or the process did not end by its handler');
  assert.deepEqual(entries(base), [], 'the exit sweep did not remove the scope');
});


/* Round 3 of review: two modules that each added a "stand aside if another listener
   exists" signal handler stood aside for EACH OTHER, so on SIGTERM only the last one
   swept. test-support/remove-at-end.js gives the process one handler for all of them. */
const SANDBOX = path.join(__dirname, 'docs', 'browser-checks', 'lib-sandbox-home.js');
const REMOVE = path.join(__dirname, 'test-support', 'remove-at-end.js');

async function termAfterReady(t, base, code) {
  const c = spawn(process.execPath, ['-e', code], { env: { ...process.env, TMPDIR: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((res, rej) => {
    c.stdout.on('data', (b) => { if (String(b).includes('ready')) res(); });
    c.on('exit', () => rej(new Error('the child exited before it was ready')));
  });
  const made = entries(base).length;
  const ended = new Promise((res) => c.on('exit', (code2, sig) => res(sig)));
  c.kill('SIGTERM');
  return { made, sig: await ended };
}

test('two modules sweeping on SIGTERM in one process BOTH sweep (lib-sandbox-home beside a second one, as thread-server runs)', { timeout: 15000 }, async (t) => {
  const base = freshBase(t);
  const code = `require(${JSON.stringify(SANDBOX)});
    const fs=require('fs'),os=require('os'),path=require('path');
    const d=fs.mkdtempSync(path.join(os.tmpdir(),'aw-thread-config-'));
    require(${JSON.stringify(REMOVE)}).removeAtEnd(()=>fs.rmSync(d,{recursive:true,force:true}));
    console.log('ready'); setInterval(()=>{},1000);`;
  const { made, sig } = await termAfterReady(t, base, code);
  assert.ok(made >= 2, `expected folders from both modules while running, saw ${made}`);
  assert.equal(sig, 'SIGTERM', 'the process should still end by the signal it was sent');
  assert.deepEqual(entries(base), [], 'a module\'s folders were left behind on SIGTERM');
});

test('control: two independent stand-aside handlers leave the first one\'s folder (the shape this replaced)', { timeout: 15000 }, async (t) => {
  const base = freshBase(t);
  const oldShape = (name) => `{ const d=fs.mkdtempSync(path.join(os.tmpdir(),'${name}-'));
    const sweep=()=>fs.rmSync(d,{recursive:true,force:true}); process.on('exit',sweep);
    process.once('SIGTERM',()=>{ if(process.listenerCount('SIGTERM')>0) return; sweep(); process.kill(process.pid,'SIGTERM'); }); }`;
  const code = `const fs=require('fs'),os=require('os'),path=require('path');
    ${oldShape('first')} ${oldShape('second')}
    console.log('ready'); setInterval(()=>{},1000);`;
  await termAfterReady(t, base, code);
  assert.deepEqual(entries(base).map((n) => n.split('-')[0]), ['first'], 'the old shape did not leak, so the test above cannot tell the fix from it');
});

/* kosmos#5334: a foreign handler that RE-RAISES (removes itself and sends the signal again, so it never seizes the
   exit code) makes the process die by the default action, and 'exit' never fires. engine/remote.js does exactly that,
   and thread-server loads it after lib-sandbox-home: every browser-check run left 3 `kosmos-bc-home-` folders and
   thread-server's `aw-thread-config-` folder. The registry now listens once more when it stands aside. */
const REMOTE = path.join(__dirname, 'engine', 'remote.js');

test('#5334: lib-sandbox-home beside the REAL engine/remote.js (its SIGTERM re-raise) leaves nothing on SIGTERM', { timeout: 15000 }, async (t) => {
  const base = freshBase(t);
  const code = `require(${JSON.stringify(SANDBOX)}); require(${JSON.stringify(REMOTE)});
    if (!process.listeners('SIGTERM').some((f) => String(f).includes('process.kill(process.pid, sig)') && String(f).includes('removeListener'))) { console.log('NO-REMOTE-RERAISE'); process.exit(7); }
    console.log('ready'); setInterval(()=>{},1000);`;
  // A home of its own from lib-sandbox-home (so not the caller's), and remote.js's data kept inside base.
  const env = { ...process.env, AGENT_WORKFORCE_DATA: path.join(base, 'data') }; delete env.AGENT_WORKFORCE_HOME;
  const c = spawn(process.execPath, ['-e', code], { env: { ...env, TMPDIR: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((res, rej) => {
    c.stdout.on('data', (b) => { const o = String(b); if (o.includes('NO-REMOTE-RERAISE')) rej(new Error('engine/remote.js no longer re-raises SIGTERM; this arm no longer tests that shape, rewrite it')); if (o.includes('ready')) res(); });
    c.on('exit', () => rej(new Error('the child exited before it was ready')));
  });
  const made = entries(base).filter((n) => n.startsWith('kosmos-bc-home-')).length;
  const ended = new Promise((res) => c.on('exit', (code2, sig) => res(sig)));
  c.kill('SIGTERM');
  assert.ok(made >= 1, `expected lib-sandbox-home's folders while running, saw ${made}`);
  assert.equal(await ended, 'SIGTERM', 'the process should still end by the signal (the re-raise is kept)');
  assert.deepEqual(entries(base).filter((n) => n !== 'data'), [], 'folders were left behind when a foreign handler re-raised SIGTERM');
});

test('#5334: a foreign handler that removes itself and re-raises still gets the sweep (the shape, independent of remote.js)', { timeout: 15000 }, async (t) => {
  const base = freshBase(t);
  const code = `const fs=require('fs'),os=require('os'),path=require('path');
    const d=fs.mkdtempSync(path.join(os.tmpdir(),'mine-'));
    require(${JSON.stringify(REMOVE)}).removeAtEnd(()=>fs.rmSync(d,{recursive:true,force:true}));
    const h=()=>{ process.removeListener('SIGTERM',h); process.kill(process.pid,'SIGTERM'); }; process.on('SIGTERM',h);
    console.log('ready'); setInterval(()=>{},1000);`;
  const { made, sig } = await termAfterReady(t, base, code);
  assert.equal(made, 1);
  assert.equal(sig, 'SIGTERM');
  assert.deepEqual(entries(base), [], 'the folder was left behind when the foreign handler re-raised');
});

test('#5334 control: the old stand-aside handler beside a re-raising one leaves its folder (so the arms above can fail)', { timeout: 15000 }, async (t) => {
  const base = freshBase(t);
  const code = `const fs=require('fs'),os=require('os'),path=require('path');
    const d=fs.mkdtempSync(path.join(os.tmpdir(),'old-')); const sweep=()=>fs.rmSync(d,{recursive:true,force:true});
    process.on('exit',sweep);
    process.once('SIGTERM',()=>{ if(process.listenerCount('SIGTERM')>0) return; sweep(); process.kill(process.pid,'SIGTERM'); });
    const h=()=>{ process.removeListener('SIGTERM',h); process.kill(process.pid,'SIGTERM'); }; process.on('SIGTERM',h);
    console.log('ready'); setInterval(()=>{},1000);`;
  await termAfterReady(t, base, code);
  assert.deepEqual(entries(base).map((n) => n.split('-')[0]), ['old'], 'the old shape did not leak beside a re-raiser, so the arms above cannot tell the fix from it');
});

test('two copies of remove-at-end.js (two paths) still install ONE signal handler', (t) => {
  const base = freshBase(t);
  const copy = path.join(base, 'remove-at-end.js');
  fs.copyFileSync(REMOVE, copy);
  const r = spawnSync(process.execPath, ['-e', `
    require(${JSON.stringify(REMOVE)}).removeAtEnd(()=>{});
    require(${JSON.stringify(copy)}).removeAtEnd(()=>{});
    console.log(process.listenerCount('SIGTERM'));`]);
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(String(r.stdout).trim(), '1');
});

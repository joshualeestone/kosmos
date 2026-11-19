'use strict';
/**
 * kosmos#8724 item 2: `kosmos adopt` and the board's "Link this window to Kosmos" (#8719 part 2). A window adopt skips
 * as "not one of ours" that the link would accept is named with the command that links it; `kosmos adopt --link
 * <name>` says what linking means and changes nothing, and `--link <name> --confirm` links that one window. The link's
 * own checks are engine/linkwindow.js's (tested in engine/linkwindow-8719.test.js); here the CLI's wiring is driven
 * against stand-in engine modules in a temp KOSMOS_HOME, each recording what it was asked.
 *
 *   node --test cli.adopt-link-8724.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');

/* The stand-ins. Rows and panes come from env; linkwindow's plan accepts only names listed in LINKABLE, and link
   records every call to LINK_LOG. adopt.plan is the real one's shape: a row not marked ours is skipped. */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8724-adopt-'));
  const root = path.join(home, 'root');
  const eng = path.join(home, 'app', 'engine');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(eng, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(eng, 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(eng, 'status.js'), [
    'module.exports = {',
    '  paneRoster: () => JSON.parse(process.env.T_ROWS || "[]"),',
    '  panesWithCommands: () => { if (process.env.T_PANES_THROW) throw new Error("no tmux"); return JSON.parse(process.env.T_PANES || "[]"); },',
    '};',
  ].join('\n'));
  fs.writeFileSync(path.join(eng, 'adopt.js'), [
    'module.exports = {',
    '  plan: (rows) => ({ eligible: rows.filter((r) => r.isNamedOurs).map((r) => ({ name: r.sessionName })),',
    '    skipped: rows.filter((r) => !r.isNamedOurs).map((r) => ({ name: r.sessionName, because: "not one of ours" })) }),',
    '  apply: () => [],',
    '};',
  ].join('\n'));
  fs.writeFileSync(path.join(eng, 'linkwindow.js'), [
    'const fs = require("node:fs");',
    'const ok = () => (process.env.T_LINKABLE || "").split(",").filter(Boolean);',
    'const log = (x) => fs.appendFileSync(process.env.T_LINK_LOG, JSON.stringify(x) + "\\n");',
    'module.exports = {',
    '  OUTCOME: { LINKED: "linked", REFUSED: "refused" },',
    '  plan: (name, panes) => { log({ plan: name, panes: Array.isArray(panes) }); return ok().includes(name) ? { ok: true } : { ok: false, outcome: "refused", because: "There is no window called " + name + " to link." }; },',
    '  link: (name, opts) => { log({ link: name, panes: Array.isArray(opts && opts.panes) }); return ok().includes(name) ? { outcome: "linked", session: name, name } : { outcome: "refused", because: "There is no window called " + name + " to link." }; },',
    '};',
  ].join('\n'));
  return home;
}

function run(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, ['adopt', ...args], { env, timeout: 15000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code: ' + (err.signal || err.code) + ' ' + stderr)); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function withHome(fn) {
  const home = makeHome();
  const logFile = path.join(home, 'link.log');
  fs.writeFileSync(logFile, '');
  const env = (extra) => ({ ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: path.join(home, 'root'), T_LINK_LOG: logFile, ...extra });
  const calls = () => fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  try { await fn(env, calls); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

const ROWS = JSON.stringify([{ sessionName: 'zara', isNamedOurs: false }, { sessionName: 'otto', isNamedOurs: false }]);

test('#8724 adopt names the link command for a skipped window the link would take; CONTROL: one it would not stays a plain skip', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    const out = await run([], env({ T_ROWS: ROWS, T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /^ {2}skip zara -- not one of ours; if you started it yourself, link it first: kosmos adopt --link zara$/m);
    assert.match(out.stdout, /^ {2}skip otto -- not one of ours$/m, 'a window the link refuses was offered the link');
    assert.equal(calls().filter((c) => c.link).length, 0, 'a review linked something');
  }));

test('#8724 a window list that cannot be read leaves the skip lines as they were', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env) => {
    const out = await run([], env({ T_ROWS: ROWS, T_PANES_THROW: '1', T_LINKABLE: 'zara' }));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /^ {2}skip zara -- not one of ours$/m);
  }));

test('#8724 --link without --confirm says what linking means and changes nothing', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    const out = await run(['--link', 'zara'], env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Kosmos would link the window called zara/);
    assert.match(out.stdout, /Only do this if you started that agent yourself in that window\./);
    assert.match(out.stdout, /Nothing was changed\. Run: kosmos adopt --link zara --confirm/);
    assert.deepEqual(calls().filter((c) => c.link), [], 'it linked without --confirm');
  }));

test('#8724 --link <name> --confirm links that one window, in either order; CONTROL above: without --confirm it does not', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    for (const args of [['--link', 'zara', '--confirm'], ['--confirm', '--link', 'zara']]) {
      const before = calls().filter((c) => c.link).length;
      const out = await run(args, env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
      assert.equal(out.code, 0, args.join(' ') + ': ' + out.stdout + out.stderr);
      assert.match(out.stdout, /Linked the window called zara\. To give it a Kosmos identity too, run: kosmos adopt --confirm/);
      const links = calls().filter((c) => c.link).slice(before);
      assert.deepEqual(links, [{ link: 'zara', panes: true }], args.join(' '));
    }
  }));

test('#8724 a refused link says the engine reason and exits 1', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env) => {
    for (const args of [['--link', 'otto'], ['--link', 'otto', '--confirm']]) {
      const out = await run(args, env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
      assert.equal(out.code, 1, args.join(' '));
      assert.match(out.stdout, /There is no window called otto to link\./, args.join(' '));
      assert.doesNotMatch(out.stdout, /Linked/);
    }
  }));

test('#8724 --link needs a name, and an unknown flag is refused before anything is read', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    for (const args of [['--link'], ['--link', '--confirm'], ['--frobnicate']]) {
      const out = await run(args, env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
      assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout + out.stderr);
      assert.match(out.stdout + out.stderr, /kosmos adopt/);
    }
    assert.deepEqual(calls(), [], 'a refused command reached the link');
  }));

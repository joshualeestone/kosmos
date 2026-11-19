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
require('./test-support/tmpscope');   // first: this process's temp folders (the roster rows' data root) go when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

/* Roster rows are real ones from test-support/fleet (fixture-discipline: no hand-built rows), serialized for the
   stand-in status.js in the CLI's own process. */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8724-adopt-rows-'));
const fleet = require('./test-support/fleet');
function rowsOf(specs) {
  const board = fleet.install(specs.map(([name, ours]) => fleet.agent(name, { ours })), { strict: false });
  try { return JSON.stringify(board.roster); } finally { fleet.restore(); }
}

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
    'const fs = require("node:fs");',
    'const log = (x) => fs.appendFileSync(process.env.T_LINK_LOG, JSON.stringify(x) + "\\n");',
    'module.exports = {',
    '  paneRoster: () => { log({ read: "roster" }); return JSON.parse(process.env.T_ROWS || "[]"); },',
    '  panesWithCommands: () => { log({ read: "panes" }); if (process.env.T_PANES_THROW) throw new Error("no tmux"); return JSON.parse(process.env.T_PANES || "[]"); },',
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
    /* The real plan returns { ok, session, pane, name, command } or a refusal; link returns linked or a refusal. */
    '  plan: (name, panes) => { log({ plan: name, panes: Array.isArray(panes) }); return ok().includes(name) ? { ok: true, session: name, pane: "0.0", name, command: "2.1.212", runner: process.env.T_RUNNER || "claude" } : { outcome: "refused", because: "There is no window called " + name + " to link." }; },',
    '  link: (name, opts) => { log({ link: name, panes: Array.isArray(opts && opts.panes) }); if (process.env.T_LINK_THROW) throw new Error("boom"); if (process.env.T_LINK_MARKLEFT) return { outcome: "refused", because: "Kosmos could not confirm the window called " + name + " after marking it, and could not take the mark off.", markLeft: true }; return ok().includes(name) ? { outcome: "linked", session: name, name, ...(process.env.T_RUNNER && process.env.T_RUNNER !== "claude" ? { runner: process.env.T_RUNNER } : {}) } : { outcome: "refused", because: "There is no window called " + name + " to link." }; },',
    '};',
  ].join('\n'));
  return home;
}

function run(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, ['adopt', ...args], { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code: ' + (err.signal || err.code) + ' ' + stderr)); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function withHome(fn) {
  const home = makeHome();
  const logFile = path.join(home, 'link.log');
  fs.writeFileSync(logFile, '');
  /* Built explicitly, with the fake tmux, so the CLI's own tmux pick never asks this Mac's real server. */
  const env = (extra) => ({
    PATH: process.env.PATH, HOME: home, KOSMOS_HOME: home, AGENT_WORKFORCE_HOME: home,
    AGENT_WORKFORCE_DATA: path.join(home, 'root'), AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'),
    T_LINK_LOG: logFile, ...extra,
  });
  const calls = () => fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  try { await fn(env, calls); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

const ROWS = rowsOf([['zara', false], ['otto', false]]);

test('#8724 adopt names the link command for a skipped window the link would take; CONTROL: one it would not stays a plain skip', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    const out = await run([], env({ T_ROWS: ROWS, T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /^ {2}skip zara -- not one of ours; if you started it yourself, you can link it \(kosmos adopt --link zara\), then run kosmos adopt again$/m);
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
    assert.match(out.stdout, /Kosmos would link the window called zara\. Kosmos would then type your messages into it/);
    assert.match(out.stdout, /Only do this if you started that agent yourself in that window\./);
    /* The board dialog's caveat, before consent as there. */
    assert.match(out.stdout, /Until Kosmos starts this agent itself, the board cannot restart it, and its own kosmos commands do not\nyet speak for it\./);
    assert.match(out.stdout, /Nothing was changed\. Run: kosmos adopt --link zara --confirm/);
    assert.deepEqual(calls().filter((c) => c.link), [], 'it linked without --confirm');
  }));

test('#8724 --link <name> --confirm links that one window, in either order; CONTROL above: without --confirm it does not', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    for (const args of [['--link', 'zara', '--confirm'], ['--confirm', '--link', 'zara']]) {
      const before = calls().filter((c) => c.link).length;
      const out = await run(args, env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
      assert.equal(out.code, 0, args.join(' ') + ': ' + out.stdout + out.stderr);
      assert.match(out.stdout, /Linked the window called zara\. Kosmos now treats it as its own: the board types your messages into it and shows its conversation\./);
      assert.match(out.stdout, /^The agent in it speaks as itself, and the board can restart it, only once Kosmos starts it; adopting does not change that\.$/m);
      assert.match(out.stdout, /^Run kosmos adopt to see what it would record now; nothing is recorded without --confirm\.$/m);
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

test('#8724 --link with a window list that cannot be read stops (1, not done) and links nothing', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    const out = await run(['--link', 'zara', '--confirm'], env({ T_PANES_THROW: '1', T_LINKABLE: 'zara' }));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /^Kosmos could not read the windows on this computer, so nothing was linked\.$/m);
    assert.deepEqual(calls().filter((c) => c.link || c.plan), []);
  }));

test('#8724 with nothing skipped as not ours, the review does not look at the windows', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    const out = await run([], env({ T_ROWS: rowsOf([['ivy', true]]), T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.deepEqual(calls().filter((c) => c.read === 'panes'), [], 'an extra look at the windows');
    /* CONTROL: with a not-ours row it does look (the first test's hint needs it). */
    await run([], env({ T_ROWS: ROWS, T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.equal(calls().filter((c) => c.read === 'panes').length, 1);
  }));

test('#8724 a link that may have left its mark exits 3 (may have gone through), not 1; CONTROL: a plain refusal exits 1 (below)', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env) => {
    const out = await run(['--link', 'zara', '--confirm'], env({ T_PANES: '[]', T_LINKABLE: 'zara', T_LINK_MARKLEFT: '1' }));
    assert.equal(out.code, 3, out.stdout + out.stderr);
    assert.match(out.stdout, /could not take the mark off/);
  }));

test('#8724 a link that throws says so in a sentence, never a stack; CONTROL: the plain link above succeeds', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env) => {
    const out = await run(['--link', 'zara', '--confirm'], env({ T_PANES: '[]', T_LINKABLE: 'zara', T_LINK_THROW: '1' }));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /^Kosmos could not see what is running on this computer, so nothing was changed\.$/m);
    assert.doesNotMatch(out.stdout + out.stderr, /at .*\(.*:\d+:\d+\)|Error: boom/);
  }));

test('#8724 a link module that cannot load leaves the adoption review as it was, and --link says it cannot link', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env) => {
    const home = env({}).KOSMOS_HOME;
    fs.writeFileSync(path.join(home, 'app', 'engine', 'linkwindow.js'), 'throw new Error("cannot load");\n');
    const review = await run([], env({ T_ROWS: ROWS, T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.equal(review.code, 0, review.stdout + review.stderr);
    assert.match(review.stdout, /^ {2}skip zara -- not one of ours$/m);
    const link = await run(['--link', 'zara', '--confirm'], env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.equal(link.code, 1, link.stdout + link.stderr);
    assert.match(link.stdout, /^This Kosmos cannot link windows, so nothing was linked\.$/m);
  }));

test('#8724 --link needs one name, and an unknown flag is refused before anything is read', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env, calls) => {
    for (const args of [['--link'], ['--link', '--confirm'], ['--frobnicate'], ['--link', 'zara', '--link', 'otto', '--confirm']]) {
      const out = await run(args, env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
      assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout + out.stderr);
      assert.match(out.stdout + out.stderr, /kosmos adopt/);
    }
    assert.deepEqual(calls(), [], 'a refused command read the roster or the windows, or reached the link');
  }));

test('#8724 a name that is not plain is printed in single quotes (nothing in it expands when pasted); CONTROL: a plain one is bare', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env) => {
    const odd = await run(['--link', 'my agent'], env({ T_PANES: '[]', T_LINKABLE: 'my agent' }));
    assert.equal(odd.code, 0, odd.stdout + odd.stderr);
    assert.match(odd.stdout, /Nothing was changed\. Run: kosmos adopt --link 'my agent' --confirm/);
    /* A $ and a quote: the printed argument, run through a real shell, comes back as the name itself. */
    const nasty = "a$(x)`y`'b";
    const out2 = await run(['--link', nasty], env({ T_PANES: '[]', T_LINKABLE: nasty }));
    const m = /Run: kosmos adopt --link (.+) --confirm$/m.exec(out2.stdout);
    assert.ok(m, out2.stdout);
    const back = require('node:child_process').spawnSync('/bin/sh', ['-c', 'printf %s ' + m[1]], { encoding: 'utf8' });
    assert.equal(back.stdout, nasty, 'the printed argument does not paste back as the name: ' + m[1]);
    const plain = await run(['--link', 'zara'], env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.match(plain.stdout, /Nothing was changed\. Run: kosmos adopt --link zara --confirm/);
  }));

test('#8724 the skip hint quotes a name that is not plain, and sends a name starting with - to the board', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env) => {
    const rows = rowsOf([['my agent', false], ['-x', false]]);
    const out = await run([], env({ T_ROWS: rows, T_PANES: '[]', T_LINKABLE: 'my agent,-x' }));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /^ {2}skip my agent -- not one of ours; if you started it yourself, you can link it \(kosmos adopt --link 'my agent'\), then run kosmos adopt again$/m);
    assert.match(out.stdout, /^ {2}skip -x -- not one of ours; if you started it yourself, you can link it from its page on the board$/m);
    assert.doesNotMatch(out.stdout, /--link -x/, 'a command the parser refuses was offered');
  }));

test('#8724 a Codex link promises its conversation only once Kosmos starts it; CONTROL: a Claude link says it shows now', { skip: SKIP_POSIX_SHELL }, () =>
  withHome(async (env) => {
    const pre = await run(['--link', 'zara'], env({ T_PANES: '[]', T_LINKABLE: 'zara', T_RUNNER: 'codex' }));
    assert.equal(pre.code, 0, pre.stdout + pre.stderr);
    assert.match(pre.stdout, /Kosmos would then type your messages into it and\nlook after it as one of its own agents/);
    assert.doesNotMatch(pre.stdout, /show its/);
    const done = await run(['--link', 'zara', '--confirm'], env({ T_PANES: '[]', T_LINKABLE: 'zara', T_RUNNER: 'codex' }));
    assert.match(done.stdout, /the board types your messages into it; its conversation shows on the board once Kosmos starts it\./);
    const claude = await run(['--link', 'zara', '--confirm'], env({ T_PANES: '[]', T_LINKABLE: 'zara' }));
    assert.match(claude.stdout, /the board types your messages into it and shows its conversation\./);
  }));

'use strict';
/**
 * kosmos#6358: an installed Kosmos that cannot run the board proof (#1765) sends its token without it, by design
 * (kosmos_board_proven returns 0 there). That state must be seen, not silent: `kosmos status` names it. A source
 * checkout never proves, so status says nothing there. The real CLI is sourced in bash with a throwaway
 * KOSMOS_HOME; healthy() is stubbed so status takes its "running" branch without a board.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const NOTE = /when it sends a token it cannot first check\s+that it is talking to its own board/;

function home(parts) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6358-'));
  if (parts.app) { fs.mkdirSync(path.join(h, 'app', 'engine'), { recursive: true }); fs.writeFileSync(path.join(h, 'app', 'server.js'), ''); }
  if (parts.proof) fs.writeFileSync(path.join(h, 'app', 'engine', 'boardproof.js'), '');
  if (parts.node) {
    fs.mkdirSync(path.join(h, 'runtime', 'bin'), { recursive: true });
    // A stand-in node: every step succeeds except --verify, so a stray listener on a test port is never "proven".
    fs.writeFileSync(path.join(h, 'runtime', 'bin', 'node'), '#!/bin/sh\n[ "$2" = --verify ] && exit 3\nexit 0\n', { mode: parts.node === 'noexec' ? 0o644 : 0o755 });
  }
  return h;
}

// healthy is stubbed: 'up' takes the running branch (which does not exit), 'down' the not-running one (exit 1).
function run(h, opts = {}) {
  const env = { ...process.env, KOSMOS_HOME: h, AGENT_WORKFORCE_DATA: path.join(h, 'data') };
  delete env.KOSMOS_AGENT_TOKEN; delete env.KOSMOS_AGENT_SESSION; delete env.TMUX; delete env.TMUX_PANE;
  if (opts.agent) env.KOSMOS_AGENT_SESSION = 'agent-6358';
  const up = opts.down ? 'healthy() { HEALTH_STATE=down; return 1; }' : 'healthy() { return 0; }';
  const script = `source "${CLI}"; ${up}; running_pid() { echo 4242; }; cmd_status`;
  try {
    return { code: 0, out: execFileSync('/bin/bash', ['-c', script], { env, encoding: 'utf8', timeout: 20000 }) };
  } catch (e) {
    if (typeof e.status !== 'number') throw e;
    return { code: e.status, out: String(e.stdout || '') };
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
}
function status(h, opts) { const r = run(h, opts); assert.equal(r.code, 0, r.out); return r.out; }

test('#6358: an installed Kosmos with no runtime says it sends without the board check', () => {
  const out = status(home({ app: true, proof: true }));
  assert.match(out, NOTE, out);
  assert.match(out, /Kosmos is running at/, 'the status line itself is still there');
});

test('#6358: an installed Kosmos missing the proof module says it too', () => {
  assert.match(status(home({ app: true, node: true })), NOTE);
});

test('#6358: a runtime that is not executable counts as missing', () => {
  assert.match(status(home({ app: true, proof: true, node: 'noexec' })), NOTE);
});

test('#6358: an installed Kosmos that can run the check says nothing (CONTROL for the arms above)', () => {
  const out = status(home({ app: true, proof: true, node: true }));
  assert.doesNotMatch(out, NOTE, out);
  assert.match(out, /Kosmos is running at/);
});

test('#6358: a source checkout (no app/server.js) says nothing', () => {
  const out = status(home({}));
  assert.doesNotMatch(out, NOTE);
  assert.match(out, /Kosmos is running at/, 'CONTROL: status ran and said its line');
});

test('#6358: the note shows when the board is not running too, before the exit', () => {
  const r = run(home({ app: true, proof: true }), { down: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, NOTE);
  assert.match(r.out, /Kosmos is not running/, 'CONTROL: the not-running branch ran');
});

test('#6358: a person is told to reinstall; an agent is told to tell its person', () => {
  const person = status(home({ app: true, proof: true }));
  assert.match(person, /^\s*Reinstalling Kosmos fixes it: curl -fsSL https:\/\/installkosmos\.com\/setup \| sh$/m);
  const agent = status(home({ app: true, proof: true }), { agent: true });
  assert.match(agent, NOTE);
  assert.match(agent, /Tell your person: reinstalling Kosmos fixes it\./);
  assert.doesNotMatch(agent, /^\s*Reinstalling Kosmos/m, 'an agent was told to reinstall');
});

test('#6358: the proof and the status note read one rule', () => {
  const cli = fs.readFileSync(CLI, 'utf8');
  const at = cli.indexOf('kosmos_board_proven() {'), end = cli.indexOf('\n}\n', at);
  const sAt = cli.indexOf('cmd_status() {'), sEnd = cli.indexOf('\ncmd_open() {');
  assert.ok(at > 0 && end > at && sAt > 0 && sEnd > sAt, 'a function this test reads moved: re-anchor it');
  const proven = cli.slice(at, end);
  // One path for the proof module: the rule and the proof read the same variable, and no second literal exists.
  const code = cli.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.equal((code.match(/app\/engine\/boardproof\.js/g) || []).length, 1, 'a second copy of the proof module path appeared');
  assert.match(proven, /^\s*local _bp="\$KOSMOS_BOARDPROOF"/m, 'kosmos_board_proven no longer runs the module the rule checks');
  assert.match(proven, /^\s*kosmos_proof_runnable \|\| return 0/m, 'kosmos_board_proven no longer reads the shared rule');
  const st = cli.slice(sAt, sEnd);
  assert.match(st, /^\s*if \[ -f "\$APP" \] && ! kosmos_proof_runnable; then/m, 'kosmos status no longer reads the shared rule');
});

test('#6358: the proof really reads the rule: with no runtime it sends unproven (0), with one it tries the proof', () => {
  // A port nothing listens on: an install that can run the proof tries it and gets curl's "could not connect".
  // Called under `if`, as kosmos_curl's `|| return` does: the sourced CLI sets -e, and a bare non-zero would exit.
  const net = require('node:net');
  const srv = net.createServer(); srv.listen(0, '127.0.0.1');
  return new Promise((resolve) => srv.on('listening', resolve)).then(() => {
    const port = srv.address().port; srv.close();
    const proven = (h) => {
      const env = { ...process.env, KOSMOS_HOME: h, KOSMOS_PORT: String(port), AGENT_WORKFORCE_DATA: path.join(h, 'data') };
      delete env.TMUX; delete env.TMUX_PANE;
      try {
        return Number(execFileSync('/bin/bash', ['-c', `source "${CLI}"; if kosmos_board_proven tok -m 2; then echo 0; else echo $?; fi`], { env, encoding: 'utf8', timeout: 20000 }).trim().split('\n').pop());
      } finally { fs.rmSync(h, { recursive: true, force: true }); }
    };
    assert.equal(proven(home({ app: true, proof: true })), 0, 'with no runtime the call is sent as before');
    assert.equal(proven(home({ app: true, proof: true, node: true })), 7, 'CONTROL: a whole install tried the proof and could not connect');
  });
});

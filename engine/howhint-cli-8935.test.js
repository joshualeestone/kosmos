'use strict';
/* kosmos#8935, end to end in both CLIs: the first use prints the pointer on stderr (the command's own output unchanged),
   the second does not, reading the guide counts as seen, and a person never sees it. Every call here stays local
   (a usage error or a --how read), so no board is reached; the record is this test's own file. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'howhint-cli-')));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const hash = (v) => require('node:crypto').createHash('sha256').update(v).digest('hex').slice(0, 16);
const launch = (t) => 'launch:' + hash(t);
const mark = (agent, command) => hash(agent) + '-' + command;
const marks = (root) => fs.readdirSync(path.join(root, 'how-hints')).sort();
const POINTER = 'First use of kosmos claim here: its full guide is kosmos claim --how (shown once).';

test('#8935 Mac CLI: first `kosmos claim` names its guide on stderr, once; CONTROL: a person, and an agent that read the guide', { skip: process.platform === 'win32' && 'install/kosmos is the Mac and Linux CLI' }, () => {
  const file = path.join(SANDBOX, 'mac');
  fs.mkdirSync(file);
  const run = (args, extra) => spawnSync('bash', [path.join(ROOT, 'install', 'kosmos'), ...args], {
    env: Object.assign({}, process.env, { KOSMOS_HOME: ROOT, KOSMOS_HOWHINT_ROOT: file }, extra), encoding: 'utf8', timeout: 30000,
  });
  const first = run(['claim', 'p'], { KOSMOS_AGENT_SESSION: 't8935-mac' });   // a usage error: stops before any board
  assert.equal(first.stderr.split('\n')[0], POINTER, 'the first use did not name the guide first');
  assert.ok(!first.stdout.includes('First use of'), 'the pointer went to stdout');
  const again = run(['claim', 'p'], { KOSMOS_AGENT_SESSION: 't8935-mac' });
  assert.ok(!again.stderr.includes('First use of'), 'shown a second time');
  const person = run(['claim', 'p'], { KOSMOS_AGENT_SESSION: '', KOSMOS_AGENT_TOKEN: '' });
  assert.ok(!person.stderr.includes('First use of'), 'CONTROL: a person saw it');
  const reader = run(['post', '--how'], { KOSMOS_AGENT_SESSION: 't8935-reader' });
  assert.equal(reader.status, 0);
  assert.ok(!reader.stderr.includes('First use of'), 'pointed at the guide it is reading');
  assert.ok(reader.stdout.length > 0, 'the guide itself still printed');
  assert.deepEqual(marks(file), [mark('t8935-mac', 'claim'), mark('t8935-reader', 'post')].sort());
});

test('#8935 Mac CLI: every guided command goes through the hint, which never reads stdin', { skip: process.platform === 'win32' && 'install/kosmos is the Mac and Linux CLI' }, () => {
  const src = fs.readFileSync(path.join(ROOT, 'install', 'kosmos'), 'utf8');
  const { GUIDES } = require('./howhint');
  for (const cmd of Object.keys(GUIDES)) {
    assert.match(src, new RegExp('\\n  ' + cmd + '\\)\\s+shift; _how_hint ' + cmd + ' "\\$@"; cmd_'), 'the dispatch for ' + cmd + ' does not call _how_hint');
  }
  assert.match(src, /"\$_hn" "\$_hm" "\$@" <\/dev\/null >&2 2>\/dev\/null \|\| true/, 'the hint must not read stdin, and must print to stderr');
});

test('#8935 Windows CLI: the same, through main()', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  const file = path.join(SANDBOX, 'win');
  fs.mkdirSync(file);
  const call = async (argv, session) => {
    const errs = [];
    let code;
    // KOSMOS_AGENT_TOKEN is what a real Windows agent carries (no session name).
    code = await cli.main(argv, { env: { KOSMOS_AGENT_TOKEN: session, KOSMOS_HOWHINT_ROOT: file }, out: () => {}, err: (s) => errs.push(String(s)),
      fetch: async () => { throw new Error('reached the network'); } });
    errs.code = code;
    return errs;
  };
  const first = await call(['claim', 'p'], 't8935-win');
  assert.equal(first.code, 2, 'claim p is no longer a local usage error (it could reach the network)');
  assert.equal(first[0], POINTER, 'the first use did not name the guide first');
  assert.ok(!(await call(['claim', 'p'], 't8935-win')).some((s) => s.includes('First use of')), 'shown a second time');
  assert.ok(!(await call(['claim', 'p'], '')).some((s) => s.includes('First use of')), 'CONTROL: a person saw it');
  const reader = await call(['post', '--how'], 't8935-win-reader');
  assert.equal(reader.code, 0, 'post --how failed');
  assert.ok(!reader.some((s) => s.includes('First use of')), 'pointed at the guide it is reading');
  // The record proves the hint ran for both agents, keyed by a hash of the launch token, never the token.
  assert.deepEqual(marks(file), [mark(launch('t8935-win'), 'claim'), mark(launch('t8935-win-reader'), 'post')].sort(), 'reading the guide was not recorded as seen');
  assert.ok(!marks(file).join().includes('t8935-win'), 'a launch token was written down');
});

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
const POINTER = 'First use of kosmos claim here: its full guide is kosmos claim --how (shown once).';

test('#8935 Mac CLI: first `kosmos claim` names its guide on stderr, once; CONTROL: a person, and an agent that read the guide', { skip: process.platform === 'win32' && 'install/kosmos is the Mac and Linux CLI' }, () => {
  const file = path.join(SANDBOX, 'mac.json');
  const run = (args, extra) => spawnSync('bash', [path.join(ROOT, 'install', 'kosmos'), ...args], {
    env: Object.assign({}, process.env, { KOSMOS_HOME: ROOT, KOSMOS_HOWHINT_FILE: file }, extra), encoding: 'utf8', timeout: 30000,
  });
  const first = run(['claim'], { KOSMOS_AGENT_SESSION: 't8935-mac' });
  assert.equal(first.stderr.split('\n')[0], POINTER, 'the first use did not name the guide first');
  assert.ok(!first.stdout.includes('First use of'), 'the pointer went to stdout');
  const again = run(['claim'], { KOSMOS_AGENT_SESSION: 't8935-mac' });
  assert.ok(!again.stderr.includes('First use of'), 'shown a second time');
  const person = run(['claim'], { KOSMOS_AGENT_SESSION: '' });
  assert.ok(!person.stderr.includes('First use of'), 'CONTROL: a person saw it');
  const reader = run(['post', '--how'], { KOSMOS_AGENT_SESSION: 't8935-reader' });
  assert.equal(reader.status, 0);
  assert.ok(!reader.stderr.includes('First use of'), 'pointed at the guide it is reading');
  assert.ok(reader.stdout.length > 0, 'the guide itself still printed');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { 't8935-mac': ['claim'], 't8935-reader': ['post'] });
});

test('#8935 Windows CLI: the same, through main()', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  const file = path.join(SANDBOX, 'win.json');
  const call = async (argv, session) => {
    const errs = [];
    await cli.main(argv, { env: { KOSMOS_AGENT_SESSION: session, KOSMOS_HOWHINT_FILE: file }, out: () => {}, err: (s) => errs.push(String(s)),
      fetch: async () => { throw new Error('reached the network'); } });
    return errs;
  };
  const first = await call(['claim'], 't8935-win');
  assert.equal(first[0], POINTER, 'the first use did not name the guide first');
  assert.ok(!(await call(['claim'], 't8935-win')).some((s) => s.includes('First use of')), 'shown a second time');
  assert.ok(!(await call(['claim'], '')).some((s) => s.includes('First use of')), 'CONTROL: a person saw it');
  assert.ok(!(await call(['post', '--how'], 't8935-win-reader')).some((s) => s.includes('First use of')), 'pointed at the guide it is reading');
});
